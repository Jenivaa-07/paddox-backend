/* ============================================================
   FILE: controllers/upload.controller.js
   PADDOX — GENERIC CLOUDINARY IMAGE UPLOAD
   Used by: product images, Fan Quotes driver images,
   Fan Drivers headshots, and user profile pictures.
   ============================================================ */

let cloudinary = null;

try {
  cloudinary = require('../config/cloudinary').cloudinary;
} catch (err) {
  console.warn('Cloudinary config not loaded:', err.message);
}

function safeFolder(context = 'misc') {
  const key = String(context || 'misc').toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  const folders = {
    products: 'paddox/products',
    'fan-quotes': 'paddox/fan-quotes',
    'fan-drivers': 'paddox/fan-drivers',
    profile: 'paddox/user-profiles',
    profiles: 'paddox/user-profiles',
    users: 'paddox/user-profiles',
    admin: 'paddox/admin',
    misc: 'paddox/misc'
  };

  return folders[key] || `paddox/${key}`;
}

function uploadBuffer(file, context) {
  return new Promise((resolve, reject) => {
    if (!cloudinary) {
      return reject(new Error('Cloudinary is not configured'));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: safeFolder(context),
        resource_type: 'image',
        transformation: [
          { width: 1400, height: 1400, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) return reject(error);

        resolve({
          url: result.secure_url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
          context
        });
      }
    );

    stream.end(file.buffer);
  });
}

exports.uploadImage = async (req, res) => {
  try {
    const context = String(req.body?.context || 'misc').toLowerCase();
    const role = String(req.user?.role || '').toLowerCase();

    /* User profile uploads are allowed for signed-in users.
       Admin content uploads require admin role. */
    const isProfileUpload = ['profile', 'profiles', 'users'].includes(context);

    if (!isProfileUpload && role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required for this upload'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Image file is required'
      });
    }

    const image = await uploadBuffer(req.file, context);

    return res.status(201).json({
      success: true,
      message: 'Image uploaded to Cloudinary',
      data: image,
      url: image.url,
      publicId: image.publicId
    });
  } catch (err) {
    console.error('Cloudinary image upload failed:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Image upload failed'
    });
  }
};
