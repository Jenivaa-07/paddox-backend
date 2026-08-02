
/* ============================================================
   FILE: config/cloudinary.js  —  Cloudinary Setup
   ============================================================ */
// config/cloudinary.js

const cloudinary = require('cloudinary').v2;
const CloudinaryStorage = require('multer-storage-cloudinary').CloudinaryStorage;
const multer = require('multer');

cloudinary.config({
  cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
  api_key    : process.env.CLOUDINARY_API_KEY,
  api_secret : process.env.CLOUDINARY_API_SECRET,
  secure     : true,
});

/* ── Product image storage ── */
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder         : 'paddox/products',
    allowed_formats: ['jpg','jpeg','png','webp'],
    transformation : [{ width:800, height:800, crop:'limit', quality:'auto' }],
  },
});

/* ── Wallpaper / digital asset storage ── */
const assetStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder         : 'paddox/assets',
    allowed_formats: ['jpg','jpeg','png','webp','svg'],
    transformation : [{ quality:'auto', fetch_format:'auto' }],
    resource_type  : 'image',
  },
});

/* ── Avatar storage ── */
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder         : 'paddox/avatars',
    allowed_formats: ['jpg','jpeg','png','webp'],
    transformation : [{ width:200, height:200, crop:'fill', gravity:'face', quality:'auto' }],
  },
});

const uploadProduct = multer({
  storage: productStorage,
  limits : { fileSize: 5 * 1024 * 1024 },  // 5MB
});

const uploadAsset = multer({
  storage: assetStorage,
  limits : { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits : { fileSize: 2 * 1024 * 1024 },  // 2MB
});

module.exports = { cloudinary, uploadProduct, uploadAsset, uploadAvatar };
