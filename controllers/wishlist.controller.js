/* ============================================================
   FILE: controllers/wishlist.controller.js
   PADDOX — REALTIME WISHLIST CONTROLLER
   ============================================================ */
const Wishlist = require('../models/Wishlist');
const { successResponse, errorResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

async function getOrCreateWishlist(userId) {
  let wishlist = await Wishlist.findOne({ user: userId });

  if (!wishlist) {
    wishlist = await Wishlist.create({
      user: userId,
      products: []
    });
  }

  return wishlist;
}

exports.getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id })
      .populate(
        'products',
        'name images price salePrice onSale ratings slug team category badge stock description shortDesc'
      );

    return successResponse(
      res,
      200,
      'Wishlist fetched',
      { products: wishlist?.products || [] }
    );

  } catch (err) {
    return serverError(res, err, 'Fetch wishlist failed');
  }
};

exports.addToWishlist = async (req, res) => {
  try {
    const { productId } = req.params;

    const wishlist = await getOrCreateWishlist(req.user._id);

    const exists =
      wishlist.products
        .map(p => p.toString())
        .includes(productId);

    if (!exists) {
      wishlist.products.push(productId);
      await wishlist.save();
    }

    return successResponse(
      res,
      200,
      exists ? 'Already in wishlist' : 'Added to wishlist',
      { count: wishlist.products.length }
    );

  } catch (err) {
    return serverError(res, err, 'Add wishlist failed');
  }
};

exports.removeFromWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.user._id });

    if (!wishlist) {
      return successResponse(
        res,
        200,
        'Wishlist already empty',
        { count: 0 }
      );
    }

    wishlist.products =
      wishlist.products.filter(
        p => p.toString() !== req.params.productId
      );

    await wishlist.save();

    return successResponse(
      res,
      200,
      'Removed from wishlist',
      { count: wishlist.products.length }
    );

  } catch (err) {
    return serverError(res, err, 'Remove wishlist failed');
  }
};

exports.clearWishlist = async (req, res) => {
  try {
    await Wishlist.findOneAndUpdate(
      { user: req.user._id },
      { products: [] },
      { upsert: true }
    );

    return successResponse(
      res,
      200,
      'Wishlist cleared'
    );

  } catch (err) {
    return serverError(res, err, 'Clear wishlist failed');
  }
};
