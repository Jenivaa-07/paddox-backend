const mongoose = require('mongoose');

const userCollectibleSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  code: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  category: { type: String, default: 'achievement', trim: true },
  rarity: { type: String, enum: ['Common', 'Rare', 'Epic', 'Legendary'], default: 'Common' },
  icon: { type: String, default: '🏁' },
  sourceAction: { type: String, default: '' },
  sourceMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  unlockedAt: { type: Date, default: Date.now },
  sharedCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

userCollectibleSchema.index({ user: 1, code: 1 }, { unique: true });
userCollectibleSchema.index({ user: 1, unlockedAt: -1 });

module.exports = mongoose.model('UserCollectible', userCollectibleSchema);
