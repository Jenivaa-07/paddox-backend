const mongoose = require('mongoose');

const collectibleAuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorType: { type: String, enum: ['system', 'admin'], required: true },
  action: { type: String, enum: ['issued', 'revoked', 'created_definition', 'updated_definition'], required: true },
  collectibleDefinitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollectibleDefinition', required: true },
  userCollectibleId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserCollectible' },
  reason: { type: String, required: true },
  requestId: { type: String },
  timestamp: { type: Date, default: Date.now },
  sanitizedMetadata: { type: mongoose.Schema.Types.Mixed, default: {} } // No secrets or PII
});

module.exports = mongoose.model('CollectibleAuditLog', collectibleAuditLogSchema);
