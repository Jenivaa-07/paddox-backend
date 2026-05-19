
/* ============================================================
   FILE: controllers/asset.controller.js  —  Digital Assets
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');

/* ── GET ALL ASSETS ── */
exports.getAssets = async (req, res, next) => {
  try {
    const { category, type, page=1, limit=12 } = req.query;
    const query = { isActive: true };
    if (category) query.category = category;
    if (type)     query.type     = type;

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

/* ── UPLOAD ASSET (admin) ── */
exports.uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 400, 'No file uploaded');
    const { name, description, category, type, resolution, tags } = req.body;
    const asset = await DigitalAsset.create({
      name, description, category, type, resolution,
      tags       : tags ? JSON.parse(tags) : [],
      image      : { url: req.file.path, publicId: req.file.filename },
      fileSize   : `${(req.file.size / (1024*1024)).toFixed(1)} MB`,
      uploadedBy : req.user._id,
    });
    successResponse(res, 201, 'Asset uploaded', { asset });
  } catch (err) { next(err); }
};

/* ── LOG DOWNLOAD + RETURN URL ── */
exports.downloadAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');

    /* Premium assets require auth */
    if (asset.type === 'premium' && !req.user) {
      return errorResponse(res, 401, 'Sign in to access premium wallpapers');
    }

    /* Increment download count */
    asset.downloads += 1;
    await asset.save({ validateBeforeSave: false });

    /* Award fan points for download */
    if (req.user) {
      await FanPoints.create({ user:req.user._id, action:'download', points:10, meta:{ assetId:asset._id } });
      await User.findByIdAndUpdate(req.user._id, { $inc:{ fanPoints:10 } });
    }

    successResponse(res, 200, 'Download authorised', {
      url      : asset.image.url,
      name     : asset.name,
      downloads: asset.downloads,
    });
  } catch (err) { next(err); }
};

/* ── DELETE ASSET (admin) ── */
exports.deleteAsset = async (req, res, next) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset) return errorResponse(res, 404, 'Asset not found');
    if (asset.image?.publicId) await cloudinary.uploader.destroy(asset.image.publicId);
    await asset.deleteOne();
    successResponse(res, 200, 'Asset deleted');
  } catch (err) { next(err); }
};

