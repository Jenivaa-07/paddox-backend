const mongoose = require('mongoose');

const achievementOutboxSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collectibleDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectibleDefinition', required: true },
  evidenceType: { type: String, required: true },
  trustedEventReference: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  attemptCount: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedAt: { type: Date, default: null },
  lockExpiresAt: { type: Date, default: null },
  lastErrorCode: { type: String, default: null },
  completedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

achievementOutboxSchema.pre('save', async function() {
  this.updatedAt = Date.now();
});

// Index for claiming events efficiently
achievementOutboxSchema.index({ status: 1, nextAttemptAt: 1, lockExpiresAt: 1 });

module.exports = mongoose.model('AchievementOutbox', achievementOutboxSchema);
