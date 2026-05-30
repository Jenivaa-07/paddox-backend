/* ============================================================
   FILE: models/DigitalAsset.js
   PADDOX — Digital Asset / Wallpaper Model
   Phase A4.7A: Desktop + Mobile wallpaper support
   ============================================================ */
const mongoose = require('mongoose');

const digitalAssetFileSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  publicId: { type: String, default: '' },
  fileSize: { type: String, default: '0 MB' },
  resolution: { type: String, default: '' },
  originalName: { type: String, default: '' }
}, { _id: false });

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
    default: 'wallpaper',
    lowercase: true,
  },
  type: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free',
    lowercase: true,
  },
  price: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  resolution: {
    type: String,
    default: '4K',
  },

  /* Backward-compatible cover image used by existing Fan Hub cards */
  image: {
    url: { type: String, required: true },
    publicId: { type: String, default: '' },
  },

  /* Dedicated responsive wallpaper files */
  desktopFile: {
    type: digitalAssetFileSchema,
    default: () => ({})
  },
  mobileFile: {
    type: digitalAssetFileSchema,
    default: () => ({})
  },
  thumbnail: {
    type: digitalAssetFileSchema,
    default: () => ({})
  },

  fileSize: {
    type: String,
    default: '0 MB',
  },
  downloads: {
    type: Number,
    default: 0,
  },
  desktopDownloads: {
    type: Number,
    default: 0,
  },
  mobileDownloads: {
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

digitalAssetSchema.virtual('hasDesktop').get(function() {
  return !!(this.desktopFile && this.desktopFile.url);
});

digitalAssetSchema.virtual('hasMobile').get(function() {
  return !!(this.mobileFile && this.mobileFile.url);
});

digitalAssetSchema.set('toJSON', { virtuals: true });
digitalAssetSchema.set('toObject', { virtuals: true });

module.exports =
  mongoose.models.DigitalAsset ||
  mongoose.model('DigitalAsset', digitalAssetSchema);
