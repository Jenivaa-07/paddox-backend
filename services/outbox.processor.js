const AchievementOutbox = require('../models/AchievementOutbox');
const CollectibleService = require('./collectible.service');

const MAX_RETRIES = 3;
const LOCK_DURATION_MS = 60 * 1000; // 60 seconds lock lease

async function processOutboxEvents() {
  const now = new Date();

  // Find a pending event or an expired processing event
  const event = await AchievementOutbox.findOneAndUpdate(
    {
      $or: [
        { status: 'pending', nextAttemptAt: { $lte: now } },
        { status: 'processing', lockExpiresAt: { $lt: now } } // Recover expired lease
      ]
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        lockExpiresAt: new Date(now.getTime() + LOCK_DURATION_MS),
        lastAttemptAt: now
      },
      $inc: { attemptCount: 1 }
    },
    { new: true, sort: { nextAttemptAt: 1 } }
  );

  if (!event) {
    return false; // No events to process
  }

  try {
    const result = await CollectibleService.issueCollectible({
      userId: event.userId,
      definitionId: event.collectibleDefinitionId,
      evidenceType: event.evidenceType,
      trustedEventReference: event.trustedEventReference,
      issuanceReason: 'Saved valid team/driver fan preferences',
      actorId: event.userId,
      actorType: 'system'
    });

    if (result.status === 'issued' || result.status === 'already_owned') {
      await AchievementOutbox.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            lockExpiresAt: null
          }
        }
      );
    } else {
      // Handle failure
      const isTransient = result.status === 'supply_exhausted' || result.status === 'transaction_unavailable' || result.status === 'issuance_failed';
      await handleEventFailure(event, result.status, isTransient);
    }
  } catch (error) {
    // Catch-all for unhandled rejections inside the processor
    await handleEventFailure(event, error.name || 'UnknownError', true);
  }

  // Continue processing if there are more
  return true;
}

async function handleEventFailure(event, errorCode, isTransient) {
  if (isTransient && event.attemptCount < MAX_RETRIES) {
    // Exponential backoff
    const delayMs = Math.pow(2, event.attemptCount) * 1000; 
    await AchievementOutbox.updateOne(
      { _id: event._id },
      {
        $set: {
          status: 'pending',
          lastErrorCode: errorCode,
          nextAttemptAt: new Date(Date.now() + delayMs),
          lockExpiresAt: null
        }
      }
    );
  } else {
    // Permanent failure
    await AchievementOutbox.updateOne(
      { _id: event._id },
      {
        $set: {
          status: 'failed',
          lastErrorCode: errorCode,
          lockExpiresAt: null
        }
      }
    );
  }
}

module.exports = {
  processOutboxEvents
};
