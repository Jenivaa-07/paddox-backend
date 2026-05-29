/* ============================================================
   FILE: controllers/order.controller.js
   PADDOX — SAFE ORDER CONTROLLER
   Fixes: "next is not a function" + checkout 500 crash
   ============================================================ */

const Order   = require('../models/Order');
const Cart    = require('../models/Cart');
const Product = require('../models/Product');
const FanPoints = require('../models/FanPoints');
const User    = require('../models/User');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');
const { getIO }     = require('../config/socket');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

/* ── PLACE ORDER ── */
exports.placeOrder = async (req, res) => {
  try {
    const {
      items,
      shippingAddress = {},
      paymentMethod = 'upi',
      notes = ''
    } = req.body;

    if (!items || !Array.isArray(items) || !items.length) {
      return errorResponse(res, 400, 'No items in order');
    }

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const productId = item.product || item.productId || item.id;

      if (!productId) {
        return errorResponse(res, 400, 'Product id missing in order item');
      }

      const quantity = Number(item.quantity || item.qty || 1);

      const product = await Product.findById(productId);

      if (!product) {
        return errorResponse(res, 404, `Product not found: ${productId}`);
      }

      if (!product.isActive) {
        return errorResponse(res, 400, `Product unavailable: ${product.name}`);
      }

      if (product.stock < quantity) {
        return errorResponse(res, 400, `Insufficient stock for: ${product.name}`);
      }

      const price =
        product.onSale && product.salePrice
          ? product.salePrice
          : product.price;

      subtotal += price * quantity;

      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.images?.[0]?.url || '',
        price,
        quantity,
        size: item.size || '',
        color: item.color || '',
        customisation: item.customisation || ''
      });
    }

    const shipping = subtotal >= 999 ? 0 : 99;
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + shipping + tax;

    const safeShippingAddress = {
      name: String(shippingAddress.name || '').trim(),
      line1: String(shippingAddress.line1 || shippingAddress.address || '').trim(),
      line2: String(shippingAddress.line2 || '').trim(),
      city: String(shippingAddress.city || '').trim(),
      state: String(shippingAddress.state || '').trim(),
      pincode: String(shippingAddress.pincode || shippingAddress.zip || '').trim(),
      phone: String(shippingAddress.phone || '').trim(),
      country: String(shippingAddress.country || 'India').trim() || 'India'
    };

    const requiredShippingFields = ['name', 'line1', 'city', 'state', 'pincode', 'phone'];
    const missingShippingFields = requiredShippingFields.filter(field => !safeShippingAddress[field]);

    if (missingShippingFields.length) {
      return errorResponse(
        res,
        400,
        `Missing shipping details: ${missingShippingFields.join(', ')}`
      );
    }

    if (!/^\d{6}$/.test(safeShippingAddress.pincode)) {
      return errorResponse(res, 400, 'Valid 6 digit pincode required');
    }

    if (!/^\d{10}$/.test(safeShippingAddress.phone.replace(/\D/g, ''))) {
      return errorResponse(res, 400, 'Valid 10 digit phone number required');
    }

    const allowedPaymentMethods = ['upi', 'card', 'netbanking', 'wallet', 'cod'];
    const requestedPaymentMethod = String(paymentMethod || 'upi').toLowerCase();
    const normalisedPaymentMethod = allowedPaymentMethods.includes(requestedPaymentMethod)
      ? requestedPaymentMethod
      : 'upi';

    const order = await Order.create({
      user: req.user._id,
      items: orderItems,
      shippingAddress: safeShippingAddress,
      pricing: {
        subtotal,
        shipping,
        tax,
        total
      },
      payment: {
        method: normalisedPaymentMethod,
        status: normalisedPaymentMethod === 'cod' ? 'pending' : 'paid',
        razorpayPaymentId: normalisedPaymentMethod === 'cod'
          ? ''
          : `PDX-PAY-${Date.now()}`,
        paidAt: normalisedPaymentMethod === 'cod' ? null : new Date()
      },
      notes
    });

    /* Deduct stock */
    for (const item of orderItems) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: -item.quantity } }
      );
    }

    /* Non-critical cleanup/rewards/email/socket */
    try {
      await Cart.findOneAndUpdate(
        { user: req.user._id },
        { items: [] }
      );
    } catch (err) {
      console.warn('Cart clear failed:', err.message);
    }

    let pointsEarned = Math.floor(total / 10);

    try {
      await FanPoints.create({
        user: req.user._id,
        action: 'purchase',
        points: pointsEarned,
        meta: { orderId: order._id }
      });

      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { fanPoints: pointsEarned } }
      );

      try {
        getIO().to(`user:${req.user._id}`).emit('fan:points-update', {
          points: pointsEarned,
          delta: pointsEarned,
          reason: 'purchase',
          ref: `purchase-${order._id}`,
          orderId: order._id,
          orderNumber: order.orderNumber
        });
      } catch (socketErr) {
        console.warn('Fan points socket notify failed:', socketErr.message);
      }
    } catch (err) {
      console.warn('Fan points failed:', err.message);
      pointsEarned = 0;
    }

    try {
      if (req.user?.email) {
        await sendEmail(
          req.user.email,
          `🏁 Paddox Order Confirmed — #${order.orderNumber}`,
          `<h2>Order Confirmed!</h2>
           <p>Your order <strong>#${order.orderNumber}</strong> has been placed.</p>
           <p>Total: ₹${total.toLocaleString('en-IN')}</p>`
        );
      }
    } catch (err) {
      console.warn('Order email failed:', err.message);
    }

    try {
      getIO().emit('admin:new-order', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        total
      });
    } catch (err) {
      console.warn('Socket notify failed:', err.message);
    }

    return successResponse(
      res,
      201,
      'Order placed successfully',
      { order, pointsEarned }
    );

  } catch (err) {
    return serverError(res, err, 'Place order failed');
  }
};

/* ── GET USER ORDERS ── */
exports.getMyOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const query = { user: req.user._id };

    if (status) query.status = status;

    const total = await Order.countDocuments(query);

    const orders = await Order.find(query)
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('items.product', 'name images slug');

    return paginatedResponse(
      res,
      orders,
      Number(page),
      Number(limit),
      total
    );

  } catch (err) {
    return serverError(res, err, 'Get my orders failed');
  }
};

/* ── GET SINGLE ORDER ── */
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id
    }).populate('items.product', 'name images slug team');

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    return successResponse(
      res,
      200,
      'Order fetched',
      { order }
    );

  } catch (err) {
    return serverError(res, err, 'Get order failed');
  }
};


/* ── ADMIN: GET SINGLE ORDER RECEIPT ── */
exports.adminGetOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'firstName lastName email')
      .populate('items.product', 'name images slug team');

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    return successResponse(res, 200, 'Order fetched', { order });
  } catch (err) {
    return serverError(res, err, 'Admin get order failed');
  }
};

/* ── TRACK ORDER ── */
exports.trackOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id
    }).select('orderNumber status statusHistory tracking payment.status');

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    return successResponse(
      res,
      200,
      'Tracking info fetched',
      { order }
    );

  } catch (err) {
    return serverError(res, err, 'Track order failed');
  }
};

/* ── CANCEL ORDER ── */
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    if (!['placed', 'processing'].includes(order.status)) {
      return errorResponse(
        res,
        400,
        'Order cannot be cancelled at this stage'
      );
    }

    order.status = 'cancelled';
    order.cancelReason = req.body.reason || 'Cancelled by user';

    if (Array.isArray(order.statusHistory)) {
      order.statusHistory.push({
        status: 'cancelled',
        message: order.cancelReason
      });
    }

    await order.save();

    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity } }
      );
    }

    try {
      if (req.user?.email) {
        await sendEmail(
          req.user.email,
          `❌ Paddox Order Cancelled — #${order.orderNumber}`,
          `<p>Your order <strong>#${order.orderNumber}</strong> has been cancelled.</p>`
        );
      }
    } catch (err) {
      console.warn('Cancel email failed:', err.message);
    }

    return successResponse(
      res,
      200,
      'Order cancelled successfully',
      { order }
    );

  } catch (err) {
    return serverError(res, err, 'Cancel order failed');
  }
};

/* ── ADMIN: GET ALL ORDERS ── */
exports.getAllOrders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search
    } = req.query;

    const query = {};

    if (status) query.status = status;

    if (search) {
      query.orderNumber = new RegExp(search, 'i');
    }

    const total = await Order.countDocuments(query);

    const orders = await Order.find(query)
      .sort('-createdAt')
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('user', 'firstName lastName email');

    return paginatedResponse(
      res,
      orders,
      Number(page),
      Number(limit),
      total
    );

  } catch (err) {
    return serverError(res, err, 'Get all orders failed');
  }
};

/* ── ADMIN: UPDATE ORDER STATUS ── */
exports.updateOrderStatus = async (req, res) => {
  try {
    const {
      status,
      message,
      trackingNumber,
      carrier
    } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('user', 'email firstName');

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    order.status = status;

    if (Array.isArray(order.statusHistory)) {
      order.statusHistory.push({
        status,
        message: message || `Order ${status}`
      });
    }

    if (trackingNumber) {
      order.tracking.trackingNumber = trackingNumber;
    }

    if (carrier) {
      order.tracking.carrier = carrier;
    }

    await order.save();

    try {
      getIO()
        .to(`user:${order.user._id}`)
        .emit('order:status-update', {
          orderNumber: order.orderNumber,
          status,
          message
        });
    } catch (err) {
      console.warn('Socket status failed:', err.message);
    }

    try {
      if (status === 'shipped' && order.user?.email) {
        await sendEmail(
          order.user.email,
          `🚚 Your Paddox Order is Shipped! #${order.orderNumber}`,
          `<p>Great news, ${order.user.firstName}! Your order <strong>#${order.orderNumber}</strong> has been shipped.</p>`
        );
      }
    } catch (err) {
      console.warn('Status email failed:', err.message);
    }

    return successResponse(
      res,
      200,
      'Order status updated',
      { order }
    );

  } catch (err) {
    return serverError(res, err, 'Update order status failed');
  }
};


/* ── ADMIN: DELETE ORDER PERMANENTLY ── */
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return errorResponse(res, 404, 'Order not found');
    }

    const deletedOrder = {
      _id: order._id,
      orderNumber: order.orderNumber,
      total: order.pricing?.total || 0
    };

    await Order.findByIdAndDelete(req.params.id);

    try {
      getIO().emit('order:deleted', {
        orderId: String(deletedOrder._id),
        orderNumber: deletedOrder.orderNumber
      });
    } catch (err) {
      console.warn('Socket delete notification failed:', err.message);
    }

    return successResponse(
      res,
      200,
      'Order deleted permanently',
      { order: deletedOrder }
    );

  } catch (err) {
    return serverError(res, err, 'Delete order failed');
  }
};
