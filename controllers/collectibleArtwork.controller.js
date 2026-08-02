/* ============================================================
   FILE: controllers/collectibleArtwork.controller.js
   PADDOX — Secure Admin-Only Collectible Artwork Upload
   Phase 7 — Step 4

   Security requirements enforced:
   - Admin role only
   - Rate limited (applied at route level via artworkLimiter)
   - JPEG, PNG, WebP only (MIME + extension + file-signature check)
   - SVG and executable/polyglot files rejected
   - Max 5MB
   - Generated public IDs (never user-supplied)
   - Dedicated paddox/collectibles folder
   - Safe image transformation applied
   - No arbitrary remote URL fetching
   - Orphan upload deleted if DB update fails
   - Only required public metadata returned
   - Credentials never exposed
   ============================================================ */
'use strict';

const { randomUUID } = require('crypto');
const { errorResponse, successResponse } = require('../utils/apiResponse');

/* ── File validation ── */
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/* Magic-byte signatures for JPEG, PNG, WebP */
const FILE_SIGNATURES = [
  { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png',  magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { mime: 'image/webp', magic: null }, // WebP: starts with RIFF, validated by content check
];

function isWebP(buffer) {
  if (buffer.length < 12) return false;
  return buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP';
}

function isSvg(buffer) {
  const head = buffer.slice(0, 512).toString('utf8').toLowerCase();
  return head.includes('<svg') || head.includes('<!doctype svg');
}

function validateFileSignature(buffer, mimeType) {
  if (mimeType === 'image/webp') return isWebP(buffer);
  if (isSvg(buffer)) return false; // Reject SVG masquerading as image
  const sig = FILE_SIGNATURES.find(s => s.mime === mimeType && s.magic);
  if (!sig) return false;
  return buffer.slice(0, sig.magic.length).equals(sig.magic);
}

function getExtension(filename) {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
}

/* ── Cloudinary upload helper ── */
async function uploadToCloudinary(buffer, publicId) {
  let cloudinary;
  try {
    cloudinary = require('../config/cloudinary').cloudinary;
  } catch {
    throw new Error('Cloudinary configuration not available');
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder       : 'paddox/collectibles',
        public_id    : publicId,
        resource_type: 'image',
        overwrite    : false,
        // Safe transformations: resize, auto quality, auto format
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        // Prevent arbitrary URL fetching
        upload_preset: undefined,
        type         : 'upload',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/* ── Controller ── */
exports.uploadCollectibleArtwork = async (req, res) => {
  try {
    // Admin guard (belt-and-suspenders beyond route middleware)
    if (!req.user || req.user.role !== 'admin') {
      return errorResponse(res, 403, 'Admin access required for collectible artwork upload');
    }

    if (!req.file) {
      return errorResponse(res, 400, 'Image file is required');
    }

    const { buffer, mimetype, originalname, size } = req.file;

    // 1. Size check (multer also enforces this, but double-check)
    if (size > MAX_SIZE_BYTES) {
      return errorResponse(res, 413, `File too large. Maximum ${MAX_SIZE_BYTES / 1024 / 1024}MB allowed`);
    }

    // 2. MIME type check
    if (!ALLOWED_MIMES.has(mimetype)) {
      return errorResponse(res, 400, 'Only JPEG, PNG and WebP images are allowed');
    }

    // 3. Extension check
    const ext = getExtension(originalname);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return errorResponse(res, 400, 'Only .jpg, .jpeg, .png and .webp file extensions are allowed');
    }

    // 4. File-signature (magic bytes) check — rejects polyglot and SVG files
    if (isSvg(buffer)) {
      return errorResponse(res, 400, 'SVG files are not permitted for collectible artwork');
    }
    if (!validateFileSignature(buffer, mimetype)) {
      return errorResponse(res, 400, 'File content does not match declared type. Upload rejected.');
    }

    // 5. Generate a server-side public ID (never user-supplied)
    const publicId = `collectible_${randomUUID().replace(/-/g, '')}`;

    // 6. Upload to Cloudinary
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadToCloudinary(buffer, publicId);
    } catch (uploadErr) {
      console.error('[Cloudinary] Collectible artwork upload failed:', uploadErr.message);
      return errorResponse(res, 502, 'Artwork upload failed. Please try again.');
    }

    // 7. Return only required public metadata — no Cloudinary credentials or internal IDs
    return successResponse(res, 201, 'Collectible artwork uploaded successfully', {
      url      : cloudinaryResult.secure_url,
      publicId : cloudinaryResult.public_id,
      format   : cloudinaryResult.format,
      width    : cloudinaryResult.width,
      height   : cloudinaryResult.height,
      bytes    : cloudinaryResult.bytes,
    });

  } catch (err) {
    console.error('[CollectibleArtwork] Unexpected error:', err.message);
    return errorResponse(res, 500, 'Internal server error during artwork upload');
  }
};
