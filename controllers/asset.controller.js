/* ============================================================
   FILE: controllers/asset.controller.js — Digital Assets
   Phase A4.7A: Admin polish foundation + login-gated downloads
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

function fileSizeLabel(file = {}) {
  return `${((file.size || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function fileSnapshot(file = {}, fallbackResolution = '') {
  if (!file) {
    return { url: '', publicId: '', fileSize: '0 MB', resolution: fallbackResolution || '', originalName: '' };
  }

  return {
    url: file.path || file.url || '',
    publicId: file.filename || file.public_id || '',
    fileSize: fileSizeLabel(file),
    resolution: fallbackResolution || '',
    originalName: file.originalname || ''
  };
}

function cleanTags(value) {
  try {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(t => String(t).trim()).filter(Boolean);
    if (String(value).trim().startsWith('[')) return JSON.parse(value);
    return String(value)
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function pickUpload(req, name) {
  if (req.files && Array.isArray(req.files[name]) && req.files[name][0]) return req.files[name][0];
  if (name === 'asset' && req.file) return req.file;
  return null;
}

/* ── GET ALL ASSETS ── */
exports.getAssets = async (req, res) => {
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
    return serverError(res, err, 'Fetch assets failed');
  }
};

/* ── GET SINGLE ASSET ── */
exports.getAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');
    return successResponse(res, 200, 'Asset fetched', { asset });
  } catch (err) {
    return serverError(res, err, 'Fetch asset failed');
  }
};

/* ── UPLOAD ASSET ── */
exports.uploadAsset = async (req, res) => {
  try {
    const desktopFile = pickUpload(req, 'desktopAsset') || pickUpload(req, 'asset');
    const mobileFile = pickUpload(req, 'mobileAsset');
    const thumbnailFile = pickUpload(req, 'thumbnail');

    if (!desktopFile && !mobileFile && !thumbnailFile) {
      return errorResponse(res, 400, 'No file uploaded');
    }

    const cover = thumbnailFile || desktopFile || mobileFile;
    const desktopSnapshot = fileSnapshot(desktopFile, req.body.desktopResolution || req.body.resolution || 'Desktop 4K');
    const mobileSnapshot = fileSnapshot(mobileFile, req.body.mobileResolution || 'Mobile HD');
    const thumbnailSnapshot = fileSnapshot(thumbnailFile, 'Thumbnail');

    const type = String(req.body.type || req.body.access || 'free').toLowerCase();
    const safePrice = type === 'premium' ? Number(req.body.price || 0) : 0;

    const asset = await DigitalAsset.create({
      name        : req.body.name || req.body.title || cover.originalname || 'Paddox Asset',
      description : req.body.description || 'Uploaded from PADDOX admin panel',
      category    : String(req.body.category || 'wallpaper').toLowerCase(),
      type,
      price       : safePrice,
      currency    : req.body.currency || 'INR',
      resolution  : req.body.resolution || [
        desktopSnapshot.url ? desktopSnapshot.resolution : '',
        mobileSnapshot.url ? mobileSnapshot.resolution : ''
      ].filter(Boolean).join(' + ') || 'HD',
      tags        : cleanTags(req.body.tags),
      image       : {
        url      : cover.path || cover.url,
        publicId : cover.filename || cover.public_id || '',
      },
      desktopFile : desktopSnapshot,
      mobileFile  : mobileSnapshot,
      thumbnail   : thumbnailSnapshot,
      fileSize    : fileSizeLabel(cover),
      downloads   : 0,
      isActive    : true,
      uploadedBy  : req.user?._id || undefined,
    });

    return successResponse(res, 201, 'Asset uploaded', { asset });
  } catch (err) {
    return serverError(res, err, 'Upload asset failed');
  }
};

/* ── DOWNLOAD ASSET ── */
exports.downloadAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);

    if (!asset || !asset.isActive) {
      return errorResponse(res, 404, 'Asset not found');
    }

    /*
      Phase A4.7A requirement:
      Free downloads are login-gated too. routes/asset.routes.js uses protect,
      so req.user must exist before this controller is reached.
    */
    if (!req.user) {
      return errorResponse(res, 401, 'Please login to download PADDOX wallpapers');
    }

    const format = String(req.query.format || req.body?.format || 'desktop').toLowerCase();

    if (asset.type === 'premium') {
      return res.status(402).json({
        success: false,
        premium: true,
        message: 'Premium wallpaper purchase flow will unlock this asset',
        asset: {
          id: asset._id,
          name: asset.name,
          price: asset.price || 0,
          currency: asset.currency || 'INR'
        }
      });
    }

    const selected =
      format === 'mobile'
        ? (asset.mobileFile?.url ? asset.mobileFile : asset.desktopFile)
        : (asset.desktopFile?.url ? asset.desktopFile : asset.mobileFile);

    const downloadUrl = selected?.url || asset.image?.url;

    if (!downloadUrl) {
      return errorResponse(res, 404, 'Download file missing');
    }

    asset.downloads = (asset.downloads || 0) + 1;
    if (format === 'mobile') asset.mobileDownloads = (asset.mobileDownloads || 0) + 1;
    else asset.desktopDownloads = (asset.desktopDownloads || 0) + 1;
    await asset.save({ validateBeforeSave: false });

    await FanPoints.create({
      user: req.user._id,
      action: 'download',
      points: 10,
      meta: {
        assetId: asset._id,
        assetName: asset.name,
        assetImage: asset.image?.url,
        format
      }
    }).catch(() => null);

    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { fanPoints: 10 } }
    ).catch(() => null);

    return successResponse(res, 200, 'Download authorised', {
      asset,
      format,
      downloadUrl,
      url: downloadUrl,
      name: asset.name,
      downloads: asset.downloads,
    });
  } catch (err) {
    return serverError(res, err, 'Download asset failed');
  }
};

/* ── DELETE ASSET ── */
exports.deleteAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset) return errorResponse(res, 404, 'Asset not found');

    const publicIds = [
      asset.image?.publicId,
      asset.desktopFile?.publicId,
      asset.mobileFile?.publicId,
      asset.thumbnail?.publicId
    ].filter(Boolean);

    if (cloudinary && publicIds.length) {
      await Promise.all(publicIds.map(id => cloudinary.uploader.destroy(id).catch(() => null)));
    }

    await asset.deleteOne();
    return successResponse(res, 200, 'Asset deleted');
  } catch (err) {
    return serverError(res, err, 'Delete asset failed');
  }
};

/* ── UPDATE ASSET ── */
exports.updateAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);

    if (!asset) {
      return errorResponse(res, 404, 'Asset not found');
    }

    if (req.body.name !== undefined) asset.name = req.body.name || asset.name;
    if (req.body.description !== undefined) asset.description = req.body.description || '';
    if (req.body.category !== undefined) asset.category = String(req.body.category || asset.category).toLowerCase();
    if (req.body.type !== undefined) asset.type = String(req.body.type || asset.type).toLowerCase();
    if (req.body.resolution !== undefined) asset.resolution = req.body.resolution || asset.resolution;
    if (req.body.price !== undefined) asset.price = asset.type === 'premium' ? Number(req.body.price || 0) : 0;
    if (req.body.tags !== undefined) asset.tags = cleanTags(req.body.tags);

    await asset.save();

    return successResponse(res, 200, 'Asset updated', { asset });
  } catch (err) {
    return serverError(res, err, 'Update asset failed');
  }
};
