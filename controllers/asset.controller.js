/* ============================================================
   FILE: controllers/asset.controller.js — Digital Assets
   Fully functional Cloudinary + MongoDB upload/delete/download
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

/* ── GET ALL ASSETS ── */
exports.getAssets = async (req, res, next) => {
  try {
    const { category, type, page = 1, limit = 50 } = req.query;

    const query = { isActive: true };
    if (category && category !== 'all') query.category = String(category).toLowerCase();
    if (type && type !== 'all') query.type = String(type).toLowerCase();

    const pageNo = Number(page) || 1;
    const limitNo = Number(limit) || 50;

    const total = await DigitalAsset.countDocuments(query);
    const assets = await DigitalAsset.find(query)
      .sort('-createdAt')
      .skip((pageNo - 1) * limitNo)
      .limit(limitNo)
      .select('-__v');

    return paginatedResponse(res, assets, pageNo, limitNo, total);
  } catch (err) {
    next(err);
  }
};

/* ── GET SINGLE ASSET ── */
exports.getAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');
    return successResponse(res, 200, 'Asset fetched', { asset });
  } catch (err) {
    next(err);
  }
};

/* ── UPLOAD ASSET ── */
exports.uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 400, 'No file uploaded');

    const cleanTags = (() => {
      try {
        if (!req.body.tags) return [];
        if (Array.isArray(req.body.tags)) return req.body.tags;
        return JSON.parse(req.body.tags);
      } catch {
        return String(req.body.tags || '')
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
      }
    })();

    const asset = await DigitalAsset.create({
      name        : req.body.name || req.body.title || req.file.originalname || 'Paddox Asset',
      description : req.body.description || 'Uploaded from PADDOX admin panel',
      category    : String(req.body.category || 'cars').toLowerCase(),
      type        : String(req.body.type || req.body.access || 'free').toLowerCase(),
      resolution  : req.body.resolution || '4K',
      tags        : cleanTags,
      image       : {
        url      : req.file.path,
        publicId : req.file.filename,
      },
      fileSize    : `${((req.file.size || 0) / (1024 * 1024)).toFixed(1)} MB`,
      downloads   : 0,
      isActive    : true,
      uploadedBy  : req.user?._id || undefined,
    });

    return successResponse(res, 201, 'Asset uploaded', { asset });
  } catch (err) {
    next(err);
  }
};

/* ── DOWNLOAD ASSET ── */
exports.downloadAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');

    if (asset.type === 'premium' && !req.user) {
      return errorResponse(res, 401, 'Sign in to access premium wallpapers');
    }

    asset.downloads = (asset.downloads || 0) + 1;
    await asset.save({ validateBeforeSave: false });

    if (req.user?._id) {
      await FanPoints.create({ user: req.user._id, action: 'download', points: 10, meta: { assetId: asset._id } });
      await User.findByIdAndUpdate(req.user._id, { $inc: { fanPoints: 10 } });
    }

    return successResponse(res, 200, 'Download authorised', {
      downloadUrl: asset.image?.url,
      url: asset.image?.url,
      name: asset.name,
      downloads: asset.downloads,
    });
  } catch (err) {
    next(err);
  }
};

/* ── DELETE ASSET ── */
exports.deleteAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset) return errorResponse(res, 404, 'Asset not found');

    if (asset.image?.publicId) {
      await cloudinary.uploader.destroy(asset.image.publicId).catch(() => null);
    }

    await asset.deleteOne();
    return successResponse(res, 200, 'Asset deleted');
  } catch (err) {
    next(err);
  }
};
