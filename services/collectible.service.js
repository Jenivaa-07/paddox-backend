const mongoose = require('mongoose');
const crypto = require('crypto');


const CollectibleDefinition = require('../models/CollectibleDefinition');
const UserCollectible = require('../models/UserCollectible');
const CollectibleAuditLog = require('../models/CollectibleAuditLog');

class CollectibleService {
  /**
   * Generates a deterministic HMAC-SHA256-v1 fingerprint for a collectible certificate.
   */
  static generateFingerprint(userId, definitionId, issuedAt) {
    const data = `${userId}:${definitionId}:${issuedAt.toISOString()}`;
    const secret = process.env.COLLECTIBLE_CERTIFICATE_SECRET;
    if (!secret) throw new Error("Missing COLLECTIBLE_CERTIFICATE_SECRET");
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  static generateIdempotencyKey(userId, definitionId, eligibilityRuleVersion, evidenceType, trustedEventReference) {
    const payload = `${userId}:${definitionId}:${eligibilityRuleVersion}:${evidenceType}:${trustedEventReference}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Atomically issues a collectible to a user.
   */
  static async issueCollectible(params) {
    const {
      userId,
      definitionId,
      eligibilityRuleVersion = 'v1',
      evidenceType,
      trustedEventReference,
      issuanceReason,
      actorId,
      actorType,
      requestId = null
    } = params;

    const idempotencyKey = this.generateIdempotencyKey(userId, definitionId, eligibilityRuleVersion, evidenceType, trustedEventReference);

    // 1. Check if user already owns this specific idempotency key event
    const existing = await UserCollectible.findOne({ userId, idempotencyKey });
    if (existing) {
      return { status: 'already_owned' };
    }

    // 2. Validate trusted server-side event implies the definition must be active
    const definition = await CollectibleDefinition.findById(definitionId);
    if (!definition) {
      return { status: 'not_eligible' };
    }
    if (!definition.active) {
      return { status: 'collectible_inactive' };
    }

    let attempt = 0;
    const maxRetries = 1;

    while (attempt <= maxRetries) {
      let session = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch (err) {
        return { status: 'transaction_unavailable' };
      }

      try {
        // 3. Atomically reserve one unit
        const updatedDefinition = await CollectibleDefinition.findOneAndUpdate(
          {
            _id: definitionId,
            $or: [
              { supplyLimit: null },
              { $expr: { $lt: ["$issuedCount", "$supplyLimit"] } }
            ]
          },
          { $inc: { issuedCount: 1 } },
          { returnDocument: 'after', session }
        );

        if (!updatedDefinition) {
          if (session) {
             try { await session.abortTransaction(); } catch(e) {}
             try { session.endSession(); } catch(e) {}
          }
          return { status: 'supply_exhausted' };
        }

        // 4. Safely assign edition number
        const editionNumber = updatedDefinition.supplyLimit ? updatedDefinition.issuedCount : null;
        
        const issuedAt = new Date();
        const publicCertificateId = crypto.randomUUID();
        const certificateFingerprint = this.generateFingerprint(userId, definitionId, issuedAt);

        // 5. Create UserCollectible
        const userCollectible = new UserCollectible({
          userId,
          collectibleDefinitionId: definitionId,
          issuedAt,
          issuanceReason,
          evidenceType,
          evidenceReference: trustedEventReference,
          editionNumber,
          idempotencyKey,
          publicCertificateId,
          certificateFingerprint,
          fingerprintVersion: 'HMAC-SHA256-v1',
          shareEnabled: false,
          status: 'issued'
        });

        await userCollectible.save({ session });

        // 6. Write Audit Log
        const auditLog = new CollectibleAuditLog({
          actorId,
          actorType,
          action: 'issued',
          collectibleDefinitionId: definitionId,
          userCollectibleId: userCollectible._id,
          reason: issuanceReason,
          requestId,
          sanitizedMetadata: {
            idempotencyKey,
            editionNumber
          }
        });
        await auditLog.save({ session });

        if (session) {
           await session.commitTransaction();
           session.endSession();
        }

        return { status: 'issued', userCollectible };

      } catch (error) {
        if (session) {
           try { await session.abortTransaction(); } catch(e) {}
           try { session.endSession(); } catch(e) {}
        }
        
        // Handle MongoDB Duplicate Key Error (11000) for idempotencyKey
        if (error.code === 11000) {
          return { status: 'already_owned' };
        }
        
        // Handle WriteConflict (TransientTransactionError) by retrying with jitter
        if (error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError')) {
           if (attempt < maxRetries) {
               attempt++;
               // small jitter 10-50ms
               await new Promise(r => setTimeout(r, 10 + Math.random() * 40));
               continue;
           }
        }
        
        console.error("Issuance error (sanitized):", error.name, error.message);
        return { status: 'issuance_failed' };
      }
    }
  }
}

module.exports = CollectibleService;
