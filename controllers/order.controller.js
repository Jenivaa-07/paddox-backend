/* ============================================================
   FILE: controllers/order.controller.js
   ============================================================ */
const Order   = require('../models/Order');
const Cart    = require('../models/Cart');
const Product = require('../models/Product');
const FanPoints = require('../models/FanPoints');
const User    = require('../models/User');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');
const { getIO }     = require('../config/socket');

/* ── PLACE ORDER ── */
exports.placeOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress, paymentMethod = 'razorpay', notes } = req.body;
    if (!items?.length) return errorResponse(res, 400, 'No items in order');

    /* Validate stock + build pricing */
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product)            return errorResponse(res, 404, `Product not found: ${item.product}`);
      if (product.stock < item.quantity) {
        return errorResponse(res, 400, `Insufficient stock for: ${product.name}`);
      }
      const price = product.onSale && product.salePrice ? product.salePrice : product.price;
      subtotal += price * item.quantity;
      orderItems.push({
        product    : product._id,
        name       : product.name,
        image      : product.images[0]?.url || '',
        price,
        quantity   : item.quantity,
        size       : item.size || '',
        color      : item.color || '',
        customisation: item.customisation || '',
      });
    }

    const shipping = subtotal >= 999 ? 0 : 99;
    const tax      = Math.round(subtotal * 0.05); // 5% GST
    const total    = subtotal + shipping + tax;

    const order = await Order.create({
      user           : req.user._id,
      items          : orderItems,
      shippingAddress,
      pricing        : { subtotal, shipping, tax, total },
      payment        : { method: paymentMethod },
      notes,
    });

    /* Deduct stock */
    for (const item of items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
    }

    /* Clear cart after order */
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [] });

    /* Award fan points (1 point per ₹10 spent) */
    const pointsEarned = Math.floor(total / 10);
    await FanPoints.create({ user: req.user._id, action: 'purchase', points: pointsEarned, meta: { orderId: order._id } });
    await User.findByIdAndUpdate(req.user._id, { $inc: { fanPoints: pointsEarned } });

    /* Send order confirmation email */
    await sendEmail(
      req.user.email,
      `🏁 Paddox Order Confirmed — #${order.orderNumber}`,
      `<h2>Order Confirmed!</h2><p>Your order <strong>#${order.orderNumber}</strong> has been placed. Total: ₹${total.toLocaleString('en-IN')}.</p><p>You earned <strong>${pointsEarned} Fan Points!</strong></p>`
    );

    /* Notify admin via WebSocket */
    try {
      getIO().emit('admin:new-order', { orderId: order._id, orderNumber: order.orderNumber, total });
    } catch { /* socket not critical */ }

    successResponse(res, 201, 'Order placed successfully', { order, pointsEarned });
  } catch (err) { next(err); }
};

/* ── GET USER ORDERS ── */
exports.getMyOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = { user: req.user._id };
    if (status) query.status = status;

    const total  = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('items.product', 'name images slug');

    paginatedResponse(res, orders, page, limit, total);
  } catch (err) { next(err); }
};

/* ── GET SINGLE ORDER ── */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .populate('items.product', 'name images slug team');
    if (!order) return errorResponse(res, 404, 'Order not found');
    successResponse(res, 200, 'Order fetched', { order });
  } catch (err) { next(err); }
};

/* ── TRACK ORDER ── */
exports.trackOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .select('orderNumber status statusHistory tracking payment.status');
    if (!order) return errorResponse(res, 404, 'Order not found');
    successResponse(res, 200, 'Tracking info fetched', { order });
  } catch (err) { next(err); }
};

/* ── CANCEL ORDER ── */
exports.cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return errorResponse(res, 404, 'Order not found');
    if (!['placed','processing'].includes(order.status)) {
      return errorResponse(res, 400, 'Order cannot be cancelled at this stage');
    }
    order.status       = 'cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by user';
    order.statusHistory.push({ status:'cancelled', message: order.cancelReason });
    await order.save();

    /* Restore stock */
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    }

    await sendEmail(
      req.user.email,
      `❌ Paddox Order Cancelled — #${order.orderNumber}`,
      `<p>Your order <strong>#${order.orderNumber}</strong> has been cancelled. If you paid online, a refund will be processed within 5–7 business days.</p>`
    );

    successResponse(res, 200, 'Order cancelled successfully', { order });
  } catch (err) { next(err); }
};

/* ── ADMIN: GET ALL ORDERS ── */
exports.getAllOrders = async (req, res, next) => {
  try {
    const { page=1, limit=20, status, search } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) query.orderNumber = new RegExp(search, 'i');

    const total  = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('user', 'firstName lastName email');

    paginatedResponse(res, orders, page, limit, total);
  } catch (err) { next(err); }
};

/* ── ADMIN: UPDATE ORDER STATUS ── */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status, message, trackingNumber, carrier } = req.body;
    const order = await Order.findById(req.params.id).populate('user','email firstName');
    if (!order) return errorResponse(res, 404, 'Order not found');

    order.status = status;
    order.statusHistory.push({ status, message: message || `Order ${status}` });
    if (trackingNumber) order.tracking.trackingNumber = trackingNumber;
    if (carrier)        order.tracking.carrier        = carrier;
    await order.save();

    /* Notify user via WebSocket */
    try {
      getIO().to(`user:${order.user._id}`).emit('order:status-update', {
        orderNumber: order.orderNumber, status, message,
      });
    } catch { /* not critical */ }

    /* Send email notification */
    if (status === 'shipped') {
      await sendEmail(
        order.user.email,
        `🚚 Your Paddox Order is Shipped! #${order.orderNumber}`,
        `<p>Great news, ${order.user.firstName}! Your order <strong>#${order.orderNumber}</strong> has been shipped. Tracking: <strong>${trackingNumber || 'N/A'}</strong></p>`
      );
    }

    successResponse(res, 200, 'Order status updated', { order });
  } catch (err) { next(err); }
};

