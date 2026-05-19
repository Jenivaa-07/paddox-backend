
/* ============================================================
   FILE: controllers/wishlist.controller.js
   ============================================================ */
const Wishlist = require('../models/Wishlist');
const { successResponse, errorResponse } = require('../utils/apiResponse');

exports.getWishlist = async (req, res, next) => {
  try {
    const wishlist = await Wishlist.findOne({ user:req.user._id })
      .populate('products','name images price salePrice onSale ratings slug team');
    successResponse(res, 200, 'Wishlist fetched', { products: wishlist?.products || [] });
  } catch (err) { next(err); }
};

exports.addToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.params;
    let wishlist = await Wishlist.findOne({ user:req.user._id });
    if (!wishlist) wishlist = await Wishlist.create({ user:req.user._id, products:[] });
    if (wishlist.products.map(p=>p.toString()).includes(productId)) {
      return errorResponse(res, 400, 'Already in wishlist');
    }
    wishlist.products.push(productId);
    await wishlist.save();
    successResponse(res, 200, 'Added to wishlist', { count: wishlist.products.length });
  } catch (err) { next(err); }
};

exports.removeFromWishlist = async (req, res, next) => {
  try {
    const wishlist = await Wishlist.findOne({ user:req.user._id });
    if (!wishlist) return errorResponse(res, 404, 'Wishlist not found');
    wishlist.products = wishlist.products.filter(p=>p.toString() !== req.params.productId);
    await wishlist.save();
    successResponse(res, 200, 'Removed from wishlist', { count: wishlist.products.length });
  } catch (err) { next(err); }
};

exports.clearWishlist = async (req, res, next) => {
  try {
    await Wishlist.findOneAndUpdate({ user:req.user._id }, { products:[] });
    successResponse(res, 200, 'Wishlist cleared');
  } catch (err) { next(err); }
};

