/* ============================================================
   FILE: controllers/asset.controller.js — Digital Assets
   Phase A4.7A.2: Login-gated downloads, desktop/mobile wallpapers,
   premium pricing foundation
   ============================================================ */
const DigitalAsset = require('../models/DigitalAsset');
const Order        = require('../models/Order');
const FanPoints    = require('../models/FanPoints');
const User         = require('../models/User');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');

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


function userDisplayName(user = {}) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.name ||
    (user.email ? String(user.email).split('@')[0] : 'PADDOX Fan');
}

async function findPaidDigitalOrder(userId, assetId) {
  return Order.findOne({
    user: userId,
    orderType: 'digital',
    'items.asset': assetId,
    'payment.status': 'paid',
    status: { $ne: 'cancelled' }
  }).sort('-createdAt');
}

function digitalReceiptEmail({ user, asset, order, format, downloadUrl }) {
  const name = userDisplayName(user);
  const amount = Number(order?.pricing?.total || asset.price || 0).toLocaleString('en-IN');
  const orderNo = order?.orderNumber || order?._id;
  const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://paddox.vercel.app').replace(/\/$/, '');
  const receiptUrl = `${frontendUrl}/receipt.html?orderId=${order?._id}`;

  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#080808;color:#ffffff;padding:24px">
      <div style="max-width:640px;margin:auto;border:1px solid rgba(232,0,45,.35);background:#111;padding:24px">
        <p style="color:#e8002d;letter-spacing:3px;text-transform:uppercase;font-size:12px;font-weight:700">PADDOX Digital Vault</p>
        <h2 style="margin:0 0 10px;font-size:28px;letter-spacing:1px">Wallpaper Unlocked</h2>
        <p>Hi ${name}, your premium PADDOX wallpaper purchase is confirmed.</p>
        <table style="width:100%;margin:18px 0;border-collapse:collapse;color:#fff">
          <tr><td style="padding:8px;border-bottom:1px solid #222;color:#aaa">Wallpaper</td><td style="padding:8px;border-bottom:1px solid #222;text-align:right"><strong>${asset.name}</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #222;color:#aaa">Format</td><td style="padding:8px;border-bottom:1px solid #222;text-align:right;text-transform:uppercase"><strong>${format}</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #222;color:#aaa">Order</td><td style="padding:8px;border-bottom:1px solid #222;text-align:right"><strong>#${orderNo}</strong></td></tr>
          <tr><td style="padding:8px;color:#aaa">Total Paid</td><td style="padding:8px;text-align:right;color:#e8002d;font-size:20px"><strong>₹${amount}</strong></td></tr>
        </table>
        <p style="color:#aaa">Your wallpaper is unlocked in your PADDOX account. You can download it again anytime from Account → Downloads.</p>
        <p style="margin:18px 0 0">
          <a href="${receiptUrl}" style="display:inline-block;background:#e8002d;color:#fff;text-decoration:none;padding:12px 18px;font-weight:800;letter-spacing:1px;text-transform:uppercase">View Receipt</a>
          <a href="${downloadUrl}" style="display:inline-block;margin-left:8px;border:1px solid #333;color:#fff;text-decoration:none;padding:12px 18px;font-weight:800;letter-spacing:1px;text-transform:uppercase">Download Wallpaper</a>
        </p>
      </div>
    </div>`;
}

async function loadEmailUser(req) {
  if (req.user?.email) return req.user;
  if (!req.user?._id) return req.user || {};
  return User.findById(req.user._id).select('firstName lastName name email').lean().catch(() => req.user);
}

async function sendDigitalReceiptEmail({ req, asset, order, format, downloadUrl }) {
  const user = await loadEmailUser(req);
  const to = user?.email || '';

  if (!to) {
    return { sent: false, to: '', error: 'Logged-in user email missing' };
  }

  try {
    const subject = `PADDOX Wallpaper Receipt — #${order.orderNumber || order._id}`;
    const html = digitalReceiptEmail({ user, asset, order, format, downloadUrl });
    const result = await sendEmail(to, subject, html);

    console.log('PADDOX digital receipt email sent', {
      to,
      orderId: String(order._id),
      orderNumber: order.orderNumber || '',
      providerId: result?.id || result?.data?.id || ''
    });

    return {
      sent: true,
      to,
      providerId: result?.id || result?.data?.id || ''
    };
  } catch (err) {
    console.error('PADDOX digital receipt email failed', {
      to,
      orderId: String(order?._id || ''),
      message: err.message
    });

    return { sent: false, to, error: err.message || 'Email delivery failed' };
  }
}

/* ── PURCHASE / UNLOCK PREMIUM ASSET ── */
exports.purchaseAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');
    if (!req.user) return errorResponse(res, 401, 'Please login to unlock PADDOX wallpapers');

    const format = String(req.body.format || req.query.format || 'desktop').toLowerCase() === 'mobile' ? 'mobile' : 'desktop';
    const downloadUrl = asset.variantUrl(format);
    if (!downloadUrl) return errorResponse(res, 404, `${format} wallpaper file not available`);

    if (asset.type !== 'premium') {
      return successResponse(res, 200, 'Free wallpaper does not need purchase', { asset, format, downloadUrl, url: downloadUrl });
    }

    let order = await findPaidDigitalOrder(req.user._id, asset._id);

    if (!order) {
      const amount = Math.max(0, Number(asset.price || 0));
      const displayName = userDisplayName(req.user);

      order = await Order.create({
        user: req.user._id,
        orderType: 'digital',
        items: [{
          asset: asset._id,
          itemType: 'digital',
          name: asset.name,
          image: asset.thumbnail?.url || asset.image?.url || asset.desktop?.url || asset.mobile?.url || '',
          price: amount,
          originalPrice: amount,
          productDiscount: 0,
          quantity: 1,
          format,
          downloadUrl
        }],
        shippingAddress: {
          name: displayName,
          line1: 'Digital delivery — PADDOX account download',
          line2: '',
          city: 'Online',
          state: 'Digital',
          pincode: '000000',
          country: 'India',
          phone: 'Digital order'
        },
        pricing: {
          subtotal: amount,
          shipping: 0,
          productDiscount: 0,
          discount: 0,
          totalDiscount: 0,
          tax: 0,
          total: amount
        },
        payment: {
          method: req.body.paymentMethod || 'upi',
          status: 'paid',
          razorpayPaymentId: `PDX-DIG-${Date.now()}`,
          paidAt: new Date()
        },
        status: 'delivered',
        statusHistory: [{ status: 'delivered', message: 'Premium digital wallpaper unlocked' }],
        notes: `Premium digital wallpaper unlock: ${asset.name} (${format})`
      });

    }

    /* A4.7B.1: send/resend receipt email every time the user unlocks or reopens a premium wallpaper.
       Earlier builds only attempted email on the first unlock and hid failures. */
    const email = await sendDigitalReceiptEmail({ req, asset, order, format, downloadUrl });

    return successResponse(res, 201, 'Premium wallpaper unlocked', {
      order,
      asset,
      format,
      downloadUrl,
      url: downloadUrl,
      receiptUrl: `receipt.html?orderId=${order._id}`,
      alreadyUnlocked: !!order,
      email,
      emailSent: email.sent,
      emailTo: email.to,
      emailError: email.error || ''
    });
  } catch (err) {
    return serverError(res, err, 'Purchase asset failed');
  }
};

/* ── DOWNLOAD ASSET ── */
exports.downloadAsset = async (req, res) => {
  try {
    const asset = await DigitalAsset.findById(req.params.id);
    if (!asset || !asset.isActive) return errorResponse(res, 404, 'Asset not found');

    /* Phase A4.7A.2: even free wallpapers require login. */
    if (!req.user) return errorResponse(res, 401, 'Please login to download PADDOX wallpapers');

    const format = String(req.query.format || req.body.format || 'desktop').toLowerCase();

    if (asset.type === 'premium') {
      const unlockedOrder = await findPaidDigitalOrder(req.user._id, asset._id);
      if (!unlockedOrder) {
        return errorResponse(res, 402, 'Premium wallpaper purchase required');
      }
    }

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

    const desktopFile = firstFile(req, 'desktop') || firstFile(req, 'asset');
    const mobileFile = firstFile(req, 'mobile');
    const thumbFile = firstFile(req, 'thumbnail');

    asset.name = req.body.name || asset.name;
    asset.description = req.body.description || asset.description;
    asset.category = req.body.category || asset.category;
    asset.type = access;
    asset.price = access === 'premium' ? Number(req.body.price ?? asset.price ?? 0) : 0;
    asset.orientation = req.body.orientation ? normaliseOrientation(req.body.orientation) : asset.orientation;
    asset.resolution = req.body.resolution || asset.resolution;
    asset.tags = req.body.tags !== undefined ? cleanTags(req.body.tags) : asset.tags;

    if (desktopFile) asset.desktop = filePayload(desktopFile, req.body.desktopResolution || req.body.resolution || asset.resolution || 'Desktop');
    if (mobileFile) asset.mobile = filePayload(mobileFile, req.body.mobileResolution || 'Mobile');
    if (thumbFile) asset.thumbnail = filePayload(thumbFile, 'Preview');

    const primaryUrl = asset.thumbnail?.url || asset.desktop?.url || asset.mobile?.url || asset.image?.url || '';
    const primaryPublicId = asset.thumbnail?.publicId || asset.desktop?.publicId || asset.mobile?.publicId || asset.image?.publicId || '';
    asset.image = { url: primaryUrl, publicId: primaryPublicId };
    asset.fileSize = asset.fileSize || fileSizeLabel((desktopFile?.size || 0) + (mobileFile?.size || 0) + (thumbFile?.size || 0));

    await asset.save();
    return successResponse(res, 200, 'Asset updated', { asset });
  } catch (err) {
    return serverError(res, err, 'Update asset failed');
  }
};
