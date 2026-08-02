const mongoose = require('mongoose');

const userCollectibleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  collectibleDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectibleDefinition', required: true },
  issuedAt: { type: Date, default: Date.now },
  issuanceReason: { type: String, required: true },
  evidenceType: { type: String, required: true },
  evidenceReference: { type: String, required: true }, // Private, hidden from public
  editionNumber: { type: Number, default: null },
  idempotencyKey: { type: String, required: true },
  publicCertificateId: { type: String, required: true, unique: true, index: true }, // UUID
  certificateFingerprint: { type: String, required: true }, // SHA-256
  fingerprintVersion: { type: String, default: 'HMAC-SHA256-v1' },
  shareEnabled: { type: Boolean, default: false },
  status: { type: String, enum: ['issued', 'revoked'], default: 'issued' },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revocationReason: { type: String, default: null }
});

// Unique idempotency key per user for specific event deduplication
userCollectibleSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });

// Enforce one ownership record per user per definition
userCollectibleSchema.index({ userId: 1, collectibleDefinitionId: 1 }, { unique: true });

// Partial unique index for non-null editions
userCollectibleSchema.index(
  { collectibleDefinitionId: 1, editionNumber: 1 },
  { unique: true, partialFilterExpression: { editionNumber: { $type: "number" } } }
);

module.exports = mongoose.model('UserCollectible', userCollectibleSchema);
