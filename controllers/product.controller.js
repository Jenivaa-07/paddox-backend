
/* ============================================================
   FILE: controllers/product.controller.js
   ============================================================ */
const Product = require('../models/Product');
const Review  = require('../models/Review');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { cloudinary } = require('../config/cloudinary');

/* ── GET ALL PRODUCTS ── */
exports.getProducts = async (req, res, next) => {
  try {
    const { category, team, badge, minPrice, maxPrice, sort, page=1, limit=12, search, featured } = req.query;
    const query = { isActive:true };

    if (category) query.category = category;
    if (team)     query.team     = new RegExp(team, 'i');
    if (badge)    query.badge    = badge;
    if (featured) query.isFeatured = true;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    if (search) query.$text = { $search: search };

    /* Sort */
    const sortMap = {
      'price-asc'  : { price:1 },
      'price-desc' : { price:-1 },
      'rating'     : { 'ratings.average':-1 },
      'newest'     : { createdAt:-1 },
      'featured'   : { isFeatured:-1, createdAt:-1 },
    };
    const sortObj = sortMap[sort] || sortMap['featured'];

    const skip    = (page - 1) * limit;
    const total   = await Product.countDocuments(query);
    const products= await Product.find(query).sort(sortObj).skip(skip).limit(Number(limit)).select('-__v');

    paginatedResponse(res, products, page, limit, total);
  } catch (err) { next(err); }
};

/* ── GET SINGLE PRODUCT ── */
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findOne({
      $or: [{ _id: req.params.id }, { slug: req.params.id }],
      isActive: true,
    });
    if (!product) return errorResponse(res, 404, 'Product not found');
    successResponse(res, 200, 'Product fetched', { product });
  } catch (err) { next(err); }
};

/* ── CREATE PRODUCT (admin) ── */
exports.createProduct = async (req, res, next) => {
  try {
    const images = req.files?.map(f => ({ url:f.path, publicId:f.filename, alt:f.originalname })) || [];
    const product = await Product.create({ ...req.body, images: images.length ? images : req.body.images, createdBy:req.user?._id });
    successResponse(res, 201, 'Product created', { product });
  } catch (err) { next(err); }
};

/* ── UPDATE PRODUCT (admin) ── */
exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true });
    if (!product) return errorResponse(res, 404, 'Product not found');
    successResponse(res, 200, 'Product updated', { product });
  } catch (err) { next(err); }
};

/* ── DELETE PRODUCT (admin) ── */
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return errorResponse(res, 404, 'Product not found');
    /* Delete images from Cloudinary */
    for (const img of product.images) {
      if (img.publicId) await cloudinary.uploader.destroy(img.publicId);
    }
    await product.deleteOne();
    successResponse(res, 200, 'Product deleted');
  } catch (err) { next(err); }
};

/* ── ADD REVIEW ── */
exports.addReview = async (req, res, next) => {
  try {
    const { rating, title, body } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return errorResponse(res, 404, 'Product not found');
    const exists = await Review.findOne({ product:req.params.id, user:req.user._id });
    if (exists) return errorResponse(res, 400, 'You have already reviewed this product');
    const review = await Review.create({ product:req.params.id, user:req.user._id, rating, title, body });
    successResponse(res, 201, 'Review added', { review });
  } catch (err) { next(err); }
};

/* ── GET REVIEWS ── */
exports.getReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ product:req.params.id, isApproved:true })
      .populate('user','firstName lastName avatar')
      .sort('-createdAt');
    successResponse(res, 200, 'Reviews fetched', { reviews, count:reviews.length });
  } catch (err) { next(err); }
};
