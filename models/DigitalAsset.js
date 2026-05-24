/* ============================================================
   FILE: models/DigitalAsset.js
   ============================================================ */
const mongoose = require('mongoose');

const digitalAssetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Asset name is required'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    enum: ['cars', 'drivers', 'circuits', 'art', 'abstract', 'abstract art', 'wallpaper'],
    default: 'cars',
    lowercase: true,
  },
  type: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free',
    lowercase: true,
  },
  resolution: {
    type: String,
    default: '4K',
  },
  image: {
    url: { type: String, required: true },
    publicId: { type: String },
  },
  fileSize: {
    type: String,
    default: '0 MB',
  },
  downloads: {
    type: Number,
    default: 0,
  },
  tags: [{ type: String }],
  isActive: {
    type: Boolean,
    default: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('DigitalAsset', digitalAssetSchema);
