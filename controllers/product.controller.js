/* ============================================================
   FILE: controllers/product.controller.js
   PADDOX — PRODUCT CONTROLLER
   Phase A4.1.2: Supports JSON + multipart product images.
   Images uploaded from Admin are stored in Cloudinary and saved
   as permanent Cloudinary URLs inside MongoDB.
   ============================================================ */

const Product = require('../models/Product');
const Review  = require('../models/Review');
const slugify = require('slugify');

const {
  successResponse,
  errorResponse,
  paginatedResponse
} = require('../utils/apiResponse');

let cloudinary = null;

try {
  cloudinary = require('../config/cloudinary').cloudinary;
} catch (err) {
  console.warn('Cloudinary config not loaded:', err.message);
}

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

function normaliseBadge(value) {
  const v = String(value || '').toLowerCase();

  if (!v || v === 'none' || v === 'null') return null;
  if (v === 'limited') return 'ltd';

  return v;
}

function normaliseCategory(value) {
  return String(value || 'apparel').toLowerCase();
}

function toBoolean(value, fallback = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  if (value === undefined || value === null || value === '') return fallback;
  return Boolean(value);
}

function nestedRating(body = {}) {
  return (
    body['ratings[average]'] ??
    body?.ratings?.average ??
    body.rating
  );
}

function uploadBufferToCloudinary(file) {
  return new Promise((resolve, reject) => {
    if (!cloudinary) {
      return reject(new Error('Cloudinary is not configured'));
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'paddox/products',
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
          publicId: result.public_id,
          alt: file.originalname || 'PADDOX product image'
        });
      }
    );

    stream.end(file.buffer);
  });
}

async function normaliseUploadedImages(files = []) {
  if (!files.length) return [];

  const selectedFiles = files.slice(0, 10);

  const images = [];

  for (const file of selectedFiles) {
    /* CloudinaryStorage gives file.path + file.filename. */
    if (file.path && /^https?:\/\//i.test(file.path)) {
      images.push({
        url: file.path,
        publicId: file.filename || file.public_id || '',
        alt: file.originalname || 'PADDOX product image'
      });
      continue;
    }

    /* Memory storage fallback uploads buffer to Cloudinary here. */
    if (file.buffer) {
      images.push(await uploadBufferToCloudinary(file));
    }
  }

  return images;
}

async function buildProductPayload(body = {}, req = {}) {
  const name = String(body.name || '').trim();

  const payload = {
    ...body,
    name,
    slug: body.slug || slugify(name, { lower: true, strict: true }),
    team: String(body.team || 'PADDOX Original').trim(),
    category: normaliseCategory(body.category),
    badge: normaliseBadge(body.badge),
    price: Number(body.price || 0),
    stock: Number(body.stock || 0),
    description:
      String(body.description || '').trim() ||
      `${name} from Paddox store`,
    shortDesc:
      String(body.shortDesc || body.description || '')
        .trim()
        .slice(0, 300),
    isActive: toBoolean(body.isActive, true),
    isFeatured: toBoolean(body.isFeatured, false)
  };

  if (body.salePrice === '' || body.salePrice === null || body.salePrice === undefined) {
    payload.salePrice = null;
    payload.onSale = false;
  } else if (!Number.isNaN(Number(body.salePrice))) {
    payload.salePrice = Number(body.salePrice);
    payload.onSale =
      Number(body.salePrice) > 0 &&
      Number(body.salePrice) < payload.price;
  }

  if (payload.badge === 'featured') {
    payload.isFeatured = true;
  }

  if (Array.isArray(body.images)) {
    payload.images = body.images
      .filter(img => img && img.url)
      .slice(0, 10)
      .map(img => ({
        url: img.url,
        publicId: img.publicId || '',
        alt: img.alt || name
      }));
  }

  const uploadedImages = await normaliseUploadedImages(req.files || []);

  if (uploadedImages.length) {
    payload.images = uploadedImages;
  }

  if (!payload.images || !payload.images.length) {
    payload.images = [{
      url: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=800&q=80',
      alt: name || 'Paddox product'
    }];
  }

  const ratingValue = nestedRating(body);

  if (ratingValue !== undefined) {
    const avg = Math.max(0, Math.min(5, Number(ratingValue || 0)));

    payload.ratings = {
      average: avg,
      count: Number(body['ratings[count]'] || body?.ratings?.count || (avg > 0 ? 1 : 0))
    };
  }

  if (req.user?._id) {
    payload.createdBy = req.user._id;
  }

  return payload;
}

/* ── GET ALL PRODUCTS ── */
exports.getProducts = async (req, res) => {
  try {
    const {
      category,
      team,
      badge,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 12,
      search,
      featured,
      admin
    } = req.query;

    const query = admin ? {} : { isActive: true };

    if (category) query.category = category;
    if (team) query.team = new RegExp(team, 'i');
    if (badge) query.badge = badge;
    if (featured) query.isFeatured = true;

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    if (search) query.$text = { $search: search };

    const sortMap = {
      'price-asc': { price: 1 },
      'price-desc': { price: -1 },
      rating: { 'ratings.average': -1 },
      newest: { createdAt: -1 },
      featured: { isFeatured: -1, createdAt: -1 }
    };

    const sortObj = sortMap[sort] || sortMap.featured;
    const skip = (Number(page) - 1) * Number(limit);
    const total = await Product.countDocuments(query);

    const products = await Product.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(Number(limit))
      .select('-__v');

    return paginatedResponse(res, products, Number(page), Number(limit), total);

  } catch (err) {
    return serverError(res, err, 'Get products failed');
  }
};

/* ── GET SINGLE PRODUCT ── */
exports.getProduct = async (req, res) => {
  try {
    const product = await Product.findOne({
      $or: [
        { _id: req.params.id },
        { slug: req.params.id }
      ]
    });

    if (!product) return errorResponse(res, 404, 'Product not found');

    return successResponse(res, 200, 'Product fetched', { product });

  } catch (err) {
    return serverError(res, err, 'Get product failed');
  }
};

/* ── CREATE PRODUCT ── */
exports.createProduct = async (req, res) => {
  try {
    const payload = await buildProductPayload(req.body, req);

    if (!payload.name) return errorResponse(res, 400, 'Product name required');
    if (!payload.price || payload.price < 0) return errorResponse(res, 400, 'Valid price required');

    const product = await Product.create(payload);

    return successResponse(res, 201, 'Product created', { product });

  } catch (err) {
    if (err.code === 11000) {
      return errorResponse(res, 400, 'Product already exists. Please change product name.');
    }

    return serverError(res, err, 'Create product failed');
  }
};

/* ── UPDATE PRODUCT ── */
exports.updateProduct = async (req, res) => {
  try {
    const existingProduct = await Product.findById(req.params.id);

    if (!existingProduct) return errorResponse(res, 404, 'Product not found');

    const payload = await buildProductPayload(req.body, req);

    delete payload.createdBy;

    /*
      Phase A4.1.5 safety:
      Editing text/stock/price without uploading replacement images must preserve
      existing Cloudinary image URLs instead of replacing them with a placeholder.
    */
    const hasUploadedImages = Array.isArray(req.files) && req.files.length > 0;
    const hasBodyImages = Array.isArray(req.body?.images) && req.body.images.length > 0;

    if (!hasUploadedImages && !hasBodyImages) {
      payload.images = existingProduct.images || [];
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    return successResponse(res, 200, 'Product updated', { product });

  } catch (err) {
    if (err.code === 11000) return errorResponse(res, 400, 'Duplicate product name or SKU');
    return serverError(res, err, 'Update product failed');
  }
};

/* ── DELETE PRODUCT ── */
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) return errorResponse(res, 404, 'Product not found');

    if (cloudinary) {
      for (const img of product.images || []) {
        if (img.publicId) {
          await cloudinary.uploader.destroy(img.publicId);
        }
      }
    }

    await product.deleteOne();

    return successResponse(res, 200, 'Product deleted');

  } catch (err) {
    return serverError(res, err, 'Delete product failed');
  }
};

/* ── ADD REVIEW ── */
exports.addReview = async (req, res) => {
  try {
    const { rating, title, body } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) return errorResponse(res, 404, 'Product not found');

    const exists = await Review.findOne({
      product: req.params.id,
      user: req.user._id
    });

    if (exists) return errorResponse(res, 400, 'You have already reviewed this product');

    const review = await Review.create({
      product: req.params.id,
      user: req.user._id,
      rating,
      title,
      body
    });

    return successResponse(res, 201, 'Review added', { review });

  } catch (err) {
    return serverError(res, err, 'Add review failed');
  }
};

/* ── GET REVIEWS ── */
exports.getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({
      product: req.params.id,
      isApproved: true
    })
      .populate('user', 'firstName lastName avatar')
      .sort('-createdAt');

    return successResponse(res, 200, 'Reviews fetched', {
      reviews,
      count: reviews.length
    });

  } catch (err) {
    return serverError(res, err, 'Get reviews failed');
  }
};
