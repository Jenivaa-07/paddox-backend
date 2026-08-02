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
const Coupon  = require('../models/Coupon');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/brevo');
const { getIO }     = require('../config/socket');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

function rupee(value = 0) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function paymentLabel(method = '') {
  const labels = {
    upi: 'UPI',
    card: 'Credit / Debit Card',
    netbanking: 'Net Banking',
    wallet: 'Wallet',
    cod: 'Cash on Delivery',
    razorpay: 'Online Payment'
  };
  return labels[String(method || '').toLowerCase()] || String(method || 'UPI').toUpperCase();
}

function buildMerchReceiptEmail(order, customer = {}) {
  const address = order.shippingAddress || {};
  const pricing = order.pricing || {};
  const coupon = order.coupon || {};
  const payment = order.payment || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const receiptUrl = `${(process.env.CLIENT_URL || 'https://paddox.vercel.app').replace(/\/$/, '')}/receipt.html?orderId=${encodeURIComponent(String(order._id))}`;

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #252525;">
        <div style="font-weight:800;color:#fff">${escapeHtml(item.name)}</div>
        <div style="font-size:12px;color:#888">
          Qty ${Number(item.quantity || 1)}
          ${item.size ? ` · Size ${escapeHtml(item.size)}` : ''}
          ${item.color ? ` · ${escapeHtml(item.color)}` : ''}
        </div>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #252525;text-align:right;color:#fff;font-weight:800">
        ${rupee(Number(item.price || 0) * Number(item.quantity || 1))}
      </td>
    </tr>
  `).join('');

  return `
    <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
      <div style="max-width:720px;margin:0 auto;padding:28px 18px">
        <div style="border:1px solid #262626;background:linear-gradient(145deg,#111,#070707);border-top:5px solid #e8002d;padding:28px">
          <div style="letter-spacing:6px;font-size:13px;font-weight:900;color:#e8002d;text-transform:uppercase">PADDOX</div>
          <h1 style="font-size:32px;line-height:1.1;margin:12px 0 8px;color:#fff;text-transform:uppercase">Order Receipt</h1>
          <p style="margin:0 0 22px;color:#b7b7b7;line-height:1.6">
            Hey ${escapeHtml(customer.firstName || address.name || 'Fan')}, your PADDOX merchandise order has been placed successfully.
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:22px">
            <div style="background:#151515;border:1px solid #252525;padding:14px">
              <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase">Order ID</div>
              <div style="font-size:20px;font-weight:900;color:#fff;margin-top:4px">${escapeHtml(order.orderNumber || String(order._id))}</div>
            </div>
            <div style="background:#151515;border:1px solid #252525;padding:14px">
              <div style="font-size:11px;letter-spacing:2px;color:#888;text-transform:uppercase">Payment</div>
              <div style="font-size:20px;font-weight:900;color:#fff;margin-top:4px">${escapeHtml(paymentLabel(payment.method))}</div>
            </div>
          </div>

          <div style="background:#101010;border:1px solid #252525;padding:16px;margin-bottom:22px">
            <div style="font-size:12px;letter-spacing:3px;color:#e8002d;text-transform:uppercase;font-weight:900;margin-bottom:8px">Delivery Details</div>
            <div style="color:#fff;font-weight:800">${escapeHtml(address.name)}</div>
            <div style="color:#b7b7b7;line-height:1.6;font-size:14px">
              ${escapeHtml(address.line1)}${address.line2 ? `, ${escapeHtml(address.line2)}` : ''}<br/>
              ${escapeHtml(address.city)}, ${escapeHtml(address.state)} - ${escapeHtml(address.pincode)}<br/>
              ${escapeHtml(address.country || 'India')} · ${escapeHtml(address.phone)}
            </div>
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px">
            <thead>
              <tr>
                <th align="left" style="padding:0 0 10px;color:#e8002d;font-size:12px;letter-spacing:2px;text-transform:uppercase">Items</th>
                <th align="right" style="padding:0 0 10px;color:#e8002d;font-size:12px;letter-spacing:2px;text-transform:uppercase">Amount</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div style="background:#101010;border:1px solid #252525;padding:16px;margin-bottom:22px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;color:#bbb"><span>Subtotal</span><strong>${rupee(pricing.subtotal)}</strong></div>
            ${Number(pricing.productDiscount || 0) ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;color:#bbb"><span>Product discount</span><strong>- ${rupee(pricing.productDiscount)}</strong></div>` : ''}
            ${Number(pricing.discount || 0) ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;color:#bbb"><span>Coupon ${escapeHtml(coupon.code || '')}</span><strong>- ${rupee(pricing.discount)}</strong></div>` : ''}
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;color:#bbb"><span>Shipping</span><strong>${Number(pricing.shipping || 0) ? rupee(pricing.shipping) : 'FREE'}</strong></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;color:#bbb"><span>Tax</span><strong>${rupee(pricing.tax)}</strong></div>
            <div style="display:flex;justify-content:space-between;border-top:1px solid #303030;padding-top:14px;color:#fff;font-size:20px"><span style="font-weight:900">Total Paid</span><strong style="color:#e8002d">${rupee(pricing.total)}</strong></div>
          </div>

          <a href="${receiptUrl}" style="display:inline-block;background:#e8002d;color:#fff;text-decoration:none;padding:14px 22px;font-weight:900;letter-spacing:2px;text-transform:uppercase">
            View Receipt
          </a>

          <p style="color:#777;font-size:12px;line-height:1.6;margin-top:22px">
            This is your PADDOX order receipt copy. Keep it for your records.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendMerchandiseReceiptEmail(order, req) {
  const customer =
    await User.findById(req.user._id)
      .select('firstName lastName email')
      .lean()
      .catch(() => null);

  const recipient = String(customer?.email || req.user?.email || '').trim();

  if (!recipient) {
    console.warn('PADDOX merchandise receipt email skipped: no recipient email', {
      orderId: order?._id,
      userId: req.user?._id
    });
    return { success: false, message: 'No recipient email' };
  }

  const result = await sendEmail(
    recipient,
    `🏁 PADDOX Receipt — #${order.orderNumber || order._id}`,
    buildMerchReceiptEmail(order, customer || {}),
    { replyTo: process.env.BREVO_REPLY_TO || process.env.BREVO_SENDER_EMAIL || process.env.FROM_EMAIL || undefined }
  );

  if (!result || result.success === false) {
    console.warn('PADDOX merchandise receipt email failed:', {
      orderId: order?._id,
      to: recipient,
      provider: result?.provider || 'brevo',
      status: result?.status || '',
      message: result?.message || 'Unknown email error',
      data: result?.data || null
    });
    return result || { success: false, message: 'Unknown email error' };
  }

  console.log('PADDOX merchandise receipt email sent:', {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    to: recipient,
    provider: result.provider || 'brevo',
    messageId: result.messageId || ''
  });

  return result;
}

async function resolveCheckoutCoupon(code = '', baseTotal = 0) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode) return { couponDoc: null, couponPayload: {}, discount: 0 };

  const couponDoc = await Coupon.findOne({ code: cleanCode });
  if (!couponDoc) throw new Error('Invalid coupon code');
  if (!couponDoc.isActive) throw new Error('Coupon is inactive');
  if (couponDoc.isExpired()) throw new Error('Coupon has expired');
  if (couponDoc.isUsageLimitReached()) throw new Error('Coupon usage limit reached');
  if (couponDoc.minOrderValue && Number(baseTotal || 0) < Number(couponDoc.minOrderValue || 0)) {
    throw new Error(`Minimum order value is ₹${Number(couponDoc.minOrderValue || 0).toLocaleString('en-IN')}`);
  }

  const discount = Math.max(0, Math.min(Number(couponDoc.calculateDiscount(baseTotal) || 0), Number(baseTotal || 0)));

  return {
    couponDoc,
    couponPayload: {
      code: couponDoc.code,
      type: couponDoc.type,
      value: Number(couponDoc.value || 0),
      discount
    },
    discount
  };
}

/* ── PLACE ORDER ── */
exports.placeOrder = async (req, res) => {
  try {
    const {
      items,
      shippingAddress = {},
      paymentMethod = 'upi',
      notes = '',
      couponCode = ''
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

      const originalPrice = Number(product.price || 0);
      const price =
        product.onSale && product.salePrice
          ? Number(product.salePrice)
          : originalPrice;

      subtotal += price * quantity;

      orderItems.push({
        product: product._id,
        itemType: 'product',
        name: product.name,
        image: product.images?.[0]?.url || '',
        price,
        originalPrice: Math.max(originalPrice, price),
        productDiscount: Math.max(0, Math.max(originalPrice, price) - price),
        quantity,
        size: item.size || '',
        color: item.color || '',
        customisation: item.customisation || ''
      });
    }

    const { couponDoc, couponPayload, discount } = await resolveCheckoutCoupon(couponCode, subtotal);

    const shipping = subtotal >= 999 ? 0 : 99;
    const taxableSubtotal = Math.max(0, subtotal - discount);
    const tax = Math.round(taxableSubtotal * 0.05);
    const total = taxableSubtotal + shipping + tax;

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
      orderType: 'merchandise',
      pricing: {
        subtotal,
        shipping,
        productDiscount: orderItems.reduce((sum, item) => sum + Number(item.productDiscount || 0) * Number(item.quantity || 1), 0),
        discount,
        totalDiscount: discount,
        tax,
        total
      },
      coupon: couponPayload,
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

    if (couponDoc) {
      try {
        await Coupon.findByIdAndUpdate(couponDoc._id, { $inc: { usedCount: 1 } });
      } catch (err) {
        console.warn('Coupon usage update failed:', err.message);
      }
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
    } catch (err) {
      console.warn('Fan points failed:', err.message);
      pointsEarned = 0;
    }

    try {
      await sendMerchandiseReceiptEmail(order, req);
    } catch (err) {
      console.warn('Order receipt email failed:', err.message);
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
