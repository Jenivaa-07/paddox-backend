/* ============================================================
   FILE: controllers/asset.controller.js — Digital Assets
   Phase A4.7A.2: Login-gated downloads, desktop/mobile wallpapers,
   premium pricing foundation
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({ success: false, message: err.message || label });
}

function fileSizeLabel(size = 0) {
  return `${((Number(size || 0)) / (1024 * 1024)).toFixed(1)} MB`;
}

function normaliseAccess(value = 'free') {
  const key = String(value || 'free').toLowerCase();
  return key === 'premium' ? 'premium' : 'free';
}

function normaliseOrientation(value = 'desktop') {
  const key = String(value || 'desktop').toLowerCase();
  return ['desktop', 'mobile', 'both'].includes(key) ? key : 'desktop';
}

function cleanTags(raw = '') {
  try {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String).map(t => t.trim()).filter(Boolean);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).map(t => t.trim()).filter(Boolean);
  } catch (_) {}
  return String(raw || '').split(',').map(t => t.trim()).filter(Boolean);
}

function filePayload(file, resolution = '') {
  if (!file) return { url: '', publicId: '', fileSize: '0 MB', resolution: resolution || '' };
  return {
    url: file.path || '',
    publicId: file.filename || '',
    fileSize: fileSizeLabel(file.size),
    resolution: resolution || ''
  };
}

function firstFile(req, fieldName) {
  if (req.files && Array.isArray(req.files[fieldName]) && req.files[fieldName][0]) return req.files[fieldName][0];
  if (req.file && fieldName === 'asset') return req.file;
  return null;
}

/* ── GET ALL ASSETS ── */
exports.getAssets = async (req, res) => {
  try {
    const { category, type, orientation, page = 1, limit = 50 } = req.query;
    const query = { isActive: true };

    if (category && category !== 'all') query.category = String(category).toLowerCase();
    if (type && type !== 'all') query.type = String(type).toLowerCase();
    if (orientation && orientation !== 'all') query.orientation = String(orientation).toLowerCase();

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
    const desktopFile = firstFile(req, 'desktop') || firstFile(req, 'asset');
    const mobileFile = firstFile(req, 'mobile');
    const thumbFile = firstFile(req, 'thumbnail');

    if (!desktopFile && !mobileFile) return errorResponse(res, 400, 'Upload at least a desktop or mobile wallpaper');

    const access = normaliseAccess(req.body.type || req.body.access);
    const price = access === 'premium' ? Number(req.body.price || 0) : 0;
    const orientation = normaliseOrientation(req.body.orientation || (desktopFile && mobileFile ? 'both' : mobileFile ? 'mobile' : 'desktop'));
    const primaryFile = thumbFile || desktopFile || mobileFile;

    const asset = await DigitalAsset.create({
      name: req.body.name || req.body.title || primaryFile?.originalname || 'Paddox Wallpaper',
      description: req.body.description || 'Uploaded from PADDOX admin panel',
      category: String(req.body.category || 'cars').toLowerCase(),
      type: access,
      price,
      orientation,
      resolution: req.body.resolution || req.body.desktopResolution || '4K',
      desktop: filePayload(desktopFile, req.body.desktopResolution || req.body.resolution || 'Desktop'),
      mobile: filePayload(mobileFile, req.body.mobileResolution || 'Mobile'),
      thumbnail: filePayload(thumbFile, 'Preview'),
      image: {
        url: primaryFile?.path || '',
        publicId: primaryFile?.filename || '',
      },
      fileSize: fileSizeLabel((desktopFile?.size || 0) + (mobileFile?.size || 0) + (thumbFile?.size || 0)),
      downloads: 0,
      tags: cleanTags(req.body.tags),
      isActive: true,
      uploadedBy: req.user?._id || undefined,
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
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');

    /* Phase A4.7A.2: even free wallpapers require login. */
    if (!req.user) return errorResponse(res, 401, 'Please login to download PADDOX wallpapers');

    if (asset.type === 'premium') {
      /* Payment/unlock will be completed in A4.7B. For now, block direct premium downloads. */
      return errorResponse(res, 402, 'Premium wallpaper purchase required');
    }

    const format = String(req.query.format || req.body.format || 'desktop').toLowerCase();
    const downloadUrl = asset.variantUrl(format);

    if (!downloadUrl) return errorResponse(res, 404, `${format} wallpaper file not available`);

    asset.downloads = (asset.downloads || 0) + 1;
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

    await User.findByIdAndUpdate(req.user._id, { $inc: { fanPoints: 10 } }).catch(() => null);

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
      asset.desktop?.publicId,
      asset.mobile?.publicId,
      asset.thumbnail?.publicId
    ].filter(Boolean);

    if (cloudinary) {
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
    if (!asset) return errorResponse(res, 404, 'Asset not found');

    const access = req.body.type !== undefined ? normaliseAccess(req.body.type) : asset.type;

    asset.name = req.body.name || asset.name;
    asset.description = req.body.description || asset.description;
    asset.category = req.body.category || asset.category;
    asset.type = access;
    asset.price = access === 'premium' ? Number(req.body.price ?? asset.price ?? 0) : 0;
    asset.orientation = req.body.orientation ? normaliseOrientation(req.body.orientation) : asset.orientation;
    asset.resolution = req.body.resolution || asset.resolution;
    asset.tags = req.body.tags !== undefined ? cleanTags(req.body.tags) : asset.tags;

    await asset.save();
    return successResponse(res, 200, 'Asset updated', { asset });
  } catch (err) {
    return serverError(res, err, 'Update asset failed');
  }
};
