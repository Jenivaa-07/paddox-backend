/* ============================================================
   PADDOX — Remote Product Image Import Middleware
   Accepts image URLs captured by Admin drag/drop and imports them
   into Cloudinary before the normal product controller runs.
   ============================================================ */
'use strict';

const { cloudinary } = require('../config/cloudinary');

const MAX_PRODUCT_IMAGES = 10;

function parseRemoteImages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value)
      .split(/\r?\n|,/)
      .map(item => item.trim())
      .filter(Boolean);
  }
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    const [a,b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

function safeRemoteUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:','https:'].includes(url.protocol)) return null;
    if (isPrivateHostname(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function originalNameFromUrl(value, index) {
  try {
    const pathname = new URL(value).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return name || `dragged-web-image-${index + 1}.jpg`;
  } catch (_) {
    return `dragged-web-image-${index + 1}.jpg`;
  }
}

async function importRemoteProductImages(req, res, next) {
  try {
    const supplied = parseRemoteImages(req.body?.remoteImages);
    if (!supplied.length) return next();

    const currentFiles = Array.isArray(req.files) ? req.files : [];
    const room = Math.max(0, MAX_PRODUCT_IMAGES - currentFiles.length);
    if (!room) {
      delete req.body.remoteImages;
      return next();
    }

    const unique = [];
    const seen = new Set();
    supplied.forEach(value => {
      const url = safeRemoteUrl(value);
      if (!url || seen.has(url) || unique.length >= room) return;
      seen.add(url);
      unique.push(url);
    });

    if (!unique.length) {
      return res.status(400).json({
        success: false,
        message: 'No valid public image URL was found in the dragged image.'
      });
    }

    const imported = [];
    for (let index = 0; index < unique.length; index += 1) {
      const remoteUrl = unique[index];
      const result = await cloudinary.uploader.upload(remoteUrl, {
        folder: 'paddox/products',
        resource_type: 'image',
        transformation: [
          { width: 1400, height: 1400, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      });

      imported.push({
        path: result.secure_url,
        filename: result.public_id,
        public_id: result.public_id,
        originalname: originalNameFromUrl(remoteUrl, index),
        mimetype: `image/${result.format || 'jpeg'}`,
        size: Number(result.bytes || 0)
      });
    }

    req.files = [...currentFiles, ...imported].slice(0, MAX_PRODUCT_IMAGES);
    delete req.body.remoteImages;
    return next();
  } catch (error) {
    console.error('Remote product image import failed:', error);
    return res.status(400).json({
      success: false,
      message: `Could not import the dragged web image: ${error.message || 'remote image upload failed'}`
    });
  }
}

module.exports = { importRemoteProductImages };
