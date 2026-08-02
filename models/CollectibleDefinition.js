const mongoose = require('mongoose');

const collectibleDefinitionSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  rarity: { type: String, required: true },
  imageUrl: { type: String, required: true },
  season: { type: String },
  driverId: { type: String },
  teamId: { type: String },
  raceId: { type: String },
  eligibilityRule: { type: String, required: true },
  supplyLimit: { type: Number, default: null },
  issuedCount: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  transferable: { type: Boolean, default: false },
  blockchainStatus: { type: String, default: 'off_chain' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('CollectibleDefinition', collectibleDefinitionSchema);
