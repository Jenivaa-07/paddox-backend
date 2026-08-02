/* ============================================================
   FILE: models/AiPoster.js
   PADDOX — AI Fan Studio Poster History
   Phase A4.11C
   ============================================================ */
const mongoose = require('mongoose');

const aiPosterSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fanName: { type: String, default: 'PADDOX FAN', trim: true, maxlength: 60 },
  style: { type: String, default: 'VIP Paddock', trim: true, maxlength: 80 },
  tone: { type: String, default: '', trim: true, maxlength: 200 },
  driverInspiration: { type: String, default: '', trim: true, maxlength: 80 },
  teamMood: { type: String, default: 'PADDOX Red', trim: true, maxlength: 80 },
  outputFormat: { type: String, default: 'Portrait 4:5', trim: true, maxlength: 40 },
  creativePrompt: { type: String, default: '', trim: true, maxlength: 500 },
  promptUsed: { type: String, default: '', maxlength: 1500 },
  provider: { type: String, default: 'paddox-preview', trim: true },
  providerMode: { type: String, default: 'preview', trim: true },
  cost: { type: Number, default: 15, min: 0 },
  creditsBefore: { type: Number, default: 0, min: 0 },
  creditsAfter: { type: Number, default: 0, min: 0 },
  image: {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' },
    cloudinarySaved: { type: Boolean, default: false },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 }
  },
  status: { type: String, enum: ['generated','failed','deleted'], default: 'generated' },
  meta: { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('AiPoster', aiPosterSchema);
