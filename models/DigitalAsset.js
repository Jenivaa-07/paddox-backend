/* ============================================================
   FILE: models/DigitalAsset.js
   PADDOX — Digital Asset / Wallpaper Model
   Phase A4.7A.2: Desktop + Mobile variants, premium pricing
   ============================================================ */
const mongoose = require('mongoose');

const assetFileSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  publicId: { type: String, default: '' },
  fileSize: { type: String, default: '0 MB' },
  resolution: { type: String, default: '' }
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
    default: 'cars',
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
    min: 0,
  },
  orientation: {
    type: String,
    enum: ['desktop', 'mobile', 'both'],
    default: 'desktop',
    lowercase: true,
  },
  resolution: {
    type: String,
    default: '4K',
  },
  desktop: {
    type: assetFileSchema,
    default: () => ({})
  },
  mobile: {
    type: assetFileSchema,
    default: () => ({})
  },
  thumbnail: {
    type: assetFileSchema,
    default: () => ({})
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
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

digitalAssetSchema.virtual('isPremium').get(function() {
  return this.type === 'premium';
});

digitalAssetSchema.methods.variantUrl = function variantUrl(format = 'desktop') {
  const key = String(format || 'desktop').toLowerCase();
  if (key === 'mobile') return this.mobile?.url || this.image?.url || '';
  return this.desktop?.url || this.image?.url || '';
};

module.exports =
  mongoose.models.DigitalAsset ||
  mongoose.model('DigitalAsset', digitalAssetSchema);
