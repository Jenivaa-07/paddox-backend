/* ============================================================
   PADDOX — Remote Product Image Import Middleware
   Browser drag/drop URLs are fetched by the backend first, then
   uploaded to Cloudinary as bytes. This avoids hot-link blocking.
   ============================================================ */
'use strict';

const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { cloudinary } = require('../config/cloudinary');

const MAX_PRODUCT_IMAGES = 10;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function parseRemoteImages(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value).split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
  }
}

function isPrivateIp(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return true;

  if (net.isIP(value) === 4) {
    const [a,b] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIP(value) === 6) {
    if (value === '::1' || value === '::') return true;
    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    if (value.startsWith('::ffff:')) return isPrivateIp(value.replace('::ffff:',''));
  }

  return false;
}

async function assertPublicHost(url) {
  const hostname = String(url.hostname || '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('Private image hosts are not allowed');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private image hosts are not allowed');
    return;
  }

  const addresses = await dns.lookup(hostname,{ all:true, verbatim:true });
  if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) {
    throw new Error('Image host resolved to a private address');
  }
}

async function safeRemoteUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Only HTTP(S) image URLs are supported');
  url.username = '';
  url.password = '';
  url.hash = '';
  await assertPublicHost(url);
  return url;
}

function imageLikeContentType(value) {
  return /^image\//i.test(String(value || '').split(';')[0].trim());
}

function looksLikeImagePath(url) {
  return /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(String(url || ''));
}

async function fetchRemoteImageBuffer(rawUrl) {
  let current = await safeRemoteUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await axios.get(current.toString(), {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      timeout: 15000,
      maxContentLength: MAX_REMOTE_BYTES,
      maxBodyLength: MAX_REMOTE_BYTES,
      validateStatus: status => (status >= 200 && status < 300) || (status >= 300 && status < 400),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
        'Cache-Control': 'no-cache'
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new Error(`Image host returned redirect ${response.status} without a location`);
      current = await safeRemoteUrl(new URL(location,current).toString());
      continue;
    }

    const contentType = String(response.headers['content-type'] || '');
    const buffer = Buffer.from(response.data || []);
    if (!buffer.length) throw new Error('Dragged image returned an empty response');
    if (buffer.length > MAX_REMOTE_BYTES) throw new Error('Dragged image is larger than 8 MB');

    if (!imageLikeContentType(contentType) && !looksLikeImagePath(current.toString())) {
      throw new Error(`Dragged URL did not return an image (${contentType || 'unknown content type'})`);
    }

    return {
      buffer,
      contentType: imageLikeContentType(contentType) ? contentType.split(';')[0] : 'image/jpeg',
      finalUrl: current.toString()
    };
  }

  throw new Error('Too many redirects while importing dragged image');
}

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve,reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: 'paddox/products',
      resource_type: 'image',
      transformation: [
        { width: 1400, height: 1400, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' }
      ]
    },(error,result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

function originalNameFromUrl(value,index,format='jpg') {
  try {
    const pathname = new URL(value).pathname;
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '').replace(/[^a-zA-Z0-9._-]/g,'-');
    return name || `dragged-web-image-${index + 1}.${format || 'jpg'}`;
  } catch (_) {
    return `dragged-web-image-${index + 1}.${format || 'jpg'}`;
  }
}

async function importRemoteProductImages(req,res,next) {
  try {
    const supplied = parseRemoteImages(req.body?.remoteImages);
    if (!supplied.length) return next();

    const currentFiles = Array.isArray(req.files) ? req.files : [];
    const room = Math.max(0,MAX_PRODUCT_IMAGES - currentFiles.length);
    if (!room) {
      delete req.body.remoteImages;
      return next();
    }

    const unique = [];
    const seen = new Set();
    for (const value of supplied) {
      if (unique.length >= room) break;
      try {
        const safe = await safeRemoteUrl(value);
        const text = safe.toString();
        if (!seen.has(text)) { seen.add(text); unique.push(text); }
      } catch (_) {}
    }

    if (!unique.length) {
      return res.status(400).json({ success:false, message:'No valid public image URL was found in the dragged image.' });
    }

    const imported = [];
    for (let index = 0; index < unique.length; index += 1) {
      const sourceUrl = unique[index];
      const fetched = await fetchRemoteImageBuffer(sourceUrl);
      const result = await uploadBufferToCloudinary(fetched.buffer);
      imported.push({
        path: result.secure_url,
        filename: result.public_id,
        public_id: result.public_id,
        originalname: originalNameFromUrl(fetched.finalUrl,index,result.format || 'jpg'),
        mimetype: fetched.contentType,
        size: Number(result.bytes || fetched.buffer.length || 0)
      });
    }

    req.files = [...currentFiles,...imported].slice(0,MAX_PRODUCT_IMAGES);
    delete req.body.remoteImages;
    return next();
  } catch (error) {
    console.error('Remote product image import failed:',error);
    return res.status(400).json({
      success:false,
      message:`Could not import the dragged web image: ${error.message || 'remote image upload failed'}`
    });
  }
}

module.exports = { importRemoteProductImages };
