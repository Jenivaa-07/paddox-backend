/* ============================================================
   FILE: controllers/asset.controller.js
   Real Cloudinary uploads + real file downloads
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

/* ── GET ALL ASSETS ── */
exports.getAssets = async (req, res, next) => {
  try {
    const { category, type, page = 1, limit = 12, search } = req.query;
    const query = { isActive: true };
    if (category && category !== 'all') query.category = category;
    if (type)     query.type     = type;
    if (search)   query.name     = new RegExp(search, 'i');

    const total  = await DigitalAsset.countDocuments(query);
    const assets = await DigitalAsset.find(query)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('-__v');

    paginatedResponse(res, assets, page, limit, total);
  } catch (err) { next(err); }
};

/* ── GET SINGLE ASSET ── */
exports.getAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');
    successResponse(res, 200, 'Asset fetched', { asset });
  } catch (err) { next(err); }
};

/* ── UPLOAD NEW ASSET (admin only) ── */
exports.uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 400, 'No file uploaded');

    const { name, description, category, type, resolution, tags } = req.body;

    /* Get file size from Cloudinary response */
    const fileSizeMB = req.file.size
      ? `${(req.file.size / (1024 * 1024)).toFixed(1)} MB`
      : 'Unknown';

    const asset = await DigitalAsset.create({
      name,
      description : description || '',
      category    : category    || 'art',
      type        : type        || 'free',
      resolution  : resolution  || 'HD',
      fileSize    : fileSizeMB,
      tags        : tags ? tags.split(',').map(t => t.trim()) : [],
      image       : {
        url     : req.file.path,       /* Cloudinary URL */
        publicId: req.file.filename,   /* Cloudinary public ID */
      },
      uploadedBy  : req.user._id,
    });

    successResponse(res, 201, 'Asset uploaded successfully', { asset });
  } catch (err) { next(err); }
};

/* ── DOWNLOAD ASSET ── */
/* This is the KEY function — it returns a real downloadable URL */
exports.downloadAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');

    /* Premium assets require login */
    if (asset.type === 'premium') {
      if (!req.user) {
        return errorResponse(res, 401, 'Create a free account to download premium wallpapers');
      }
    }

    /* Generate a signed Cloudinary download URL */
    /* This URL forces a download (attachment) instead of opening in browser */
    let downloadUrl;
    try {
      /* Option 1: Use Cloudinary signed URL with download flag */
      downloadUrl = cloudinary.url(asset.image.publicId, {
        resource_type: 'image',
        type         : 'upload',
        flags        : 'attachment',   /* This makes browser download the file */
        format       : 'jpg',
        quality      : 'auto',
        secure       : true,
      });
    } catch {
      /* Option 2: Fallback — use the direct URL */
      downloadUrl = asset.image.url;
    }

    /* Track download count */
    await DigitalAsset.findByIdAndUpdate(req.params.id, {
      $inc: { downloads: 1 }
    });

    /* Award fan points for downloading */
    if (req.user) {
      const pointsEarned = asset.type === 'premium' ? 20 : 10;
      await FanPoints.create({
        user  : req.user._id,
        action: 'download',
        points: pointsEarned,
        meta  : { assetId: asset._id, assetName: asset.name }
      });
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { fanPoints: pointsEarned }
      });
    }

    successResponse(res, 200, 'Download authorised', {
      downloadUrl,
      name       : asset.name,
      resolution : asset.resolution,
      fileSize   : asset.fileSize,
      type       : asset.type,
    });

  } catch (err) { next(err); }
};

/* ── UPDATE ASSET (admin) ── */
exports.updateAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    successResponse(res, 200, 'Asset updated', { asset });
  } catch (err) { next(err); }
};

/* ── DELETE ASSET (admin) ── */
exports.deleteAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset) return errorResponse(res, 404, 'Asset not found');

    /* Delete from Cloudinary too */
    if (asset.image?.publicId) {
      await cloudinary.uploader.destroy(asset.image.publicId);
    }

    await asset.deleteOne();
    successResponse(res, 200, 'Asset deleted');
  } catch (err) { next(err); }
};

/* ── GET ASSETS BY CATEGORY ── */
exports.getByCategory = async (req, res, next) => {
  try {
    const assets = await DigitalAsset.find({
      category: req.params.cat,
      isActive: true
    }).sort('-downloads');
    successResponse(res, 200, 'Assets fetched', { assets, count: assets.length });
  } catch (err) { next(err); }
};

/* ── GET DOWNLOAD STATS (admin) ── */
exports.getDownloadStats = async (req, res, next) => {
  try {
    const stats = await DigitalAsset.aggregate([
      { $match: { isActive: true } },
      { $group: {
        _id      : '$category',
        total    : { $sum: '$downloads' },
        count    : { $sum: 1 },
        topAsset : { $max: '$name' }
      }},
      { $sort: { total: -1 } }
    ]);
    const totalDownloads = await DigitalAsset.aggregate([
      { $group: { _id: null, total: { $sum: '$downloads' } } }
    ]);
    successResponse(res, 200, 'Download stats', {
      byCategory   : stats,
      totalDownloads: totalDownloads[0]?.total || 0
    });
  } catch (err) { next(err); }
};