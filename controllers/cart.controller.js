
/* ============================================================
   FILE: controllers/cart.controller.js
   ============================================================ */
const Cart    = require('../models/Cart');
const Product = require('../models/Product');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/* ── GET CART ── */
exports.getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product','name images price salePrice onSale stock slug');
    if (!cart) return successResponse(res, 200, 'Cart is empty', { cart:{ items:[], total:0, itemCount:0 } });
    successResponse(res, 200, 'Cart fetched', {
      cart: {
        items    : cart.items,
        total    : cart.items.reduce((s,i) => s + i.price * i.quantity, 0),
        itemCount: cart.items.reduce((s,i) => s + i.quantity, 0),
      }
    });
  } catch (err) { next(err); }
};

/* ── ADD TO CART ── */
exports.addToCart = async (req, res, next) => {
  try {
    const { productId, quantity=1, size, color } = req.body;
    const product = await Product.findById(productId);
    if (!product)            return errorResponse(res, 404, 'Product not found');
    if (!product.isActive)   return errorResponse(res, 400, 'Product unavailable');
    if (product.stock < quantity) return errorResponse(res, 400, 'Insufficient stock');

    const price = product.onSale && product.salePrice ? product.salePrice : product.price;

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

    const existingIdx = cart.items.findIndex(
      i => i.product.toString() === productId && i.size === size && i.color === color
    );

    if (existingIdx > -1) {
      cart.items[existingIdx].quantity += quantity;
    } else {
      cart.items.push({ product: productId, quantity, size, color, price });
    }
    await cart.save();
    await cart.populate('items.product','name images price slug');

    successResponse(res, 200, 'Item added to cart', { cart });
  } catch (err) { next(err); }
};

/* ── UPDATE CART ITEM ── */
exports.updateCart = async (req, res, next) => {
  try {
    const { productId, quantity, size, color } = req.body;
    if (quantity < 1) return errorResponse(res, 400, 'Quantity must be at least 1');

    const product = await Product.findById(productId);
    if (product.stock < quantity) return errorResponse(res, 400, 'Insufficient stock');

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return errorResponse(res, 404, 'Cart not found');

    const item = cart.items.find(i => i.product.toString() === productId && i.size === size);
    if (!item) return errorResponse(res, 404, 'Item not in cart');

    item.quantity = quantity;
    await cart.save();
    successResponse(res, 200, 'Cart updated', { cart });
  } catch (err) { next(err); }
};

/* ── REMOVE FROM CART ── */
exports.removeFromCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return errorResponse(res, 404, 'Cart not found');
    cart.items = cart.items.filter(i => i.product.toString() !== req.params.productId);
    await cart.save();
    successResponse(res, 200, 'Item removed from cart', { cart });
  } catch (err) { next(err); }
};

/* ── CLEAR CART ── */
exports.clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [], coupon: {} });
    successResponse(res, 200, 'Cart cleared');
  } catch (err) { next(err); }
};

