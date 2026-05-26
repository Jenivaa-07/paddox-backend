/* ============================================================
   FILE: models/FanDriverProfile.js
   PADDOX — Fan Hub Driver Profile Overrides
   ============================================================ */
const mongoose = require('mongoose');

const fanDriverProfileSchema = new mongoose.Schema({
  driverKey: { type: String, required: true, unique: true, trim: true, lowercase: true },
  code: { type: String, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  team: { type: String, default: '', trim: true },
  country: { type: String, default: '', trim: true },
  flagEmoji: { type: String, default: '', trim: true },
  image: { type: String, default: '', maxlength: 500000 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

fanDriverProfileSchema.index({ driverKey: 1 });
fanDriverProfileSchema.index({ code: 1 });
fanDriverProfileSchema.index({ name: 'text', team: 'text', code: 'text' });

module.exports = mongoose.models.FanDriverProfile || mongoose.model('FanDriverProfile', fanDriverProfileSchema);
