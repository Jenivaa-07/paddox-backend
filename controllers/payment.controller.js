
/* ============================================================
   FILE: controllers/payment.controller.js  —  Razorpay
   ============================================================ */
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const Order    = require('../models/Order');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');
const { getIO }     = require('../config/socket');

const razorpay = new Razorpay({
  key_id    : process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/* ── CREATE RAZORPAY ORDER ── */
exports.createRazorpayOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findOne({ _id:orderId, user:req.user._id });
    if (!order) return errorResponse(res, 404, 'Order not found');
    if (order.payment.status === 'paid') return errorResponse(res, 400, 'Order already paid');

    const rzpOrder = await razorpay.orders.create({
      amount  : order.pricing.total * 100, // paise
      currency: 'INR',
      receipt : order.orderNumber,
      notes   : { orderId: order._id.toString(), userId: req.user._id.toString() },
    });

    order.payment.razorpayOrderId = rzpOrder.id;
    await order.save({ validateBeforeSave:false });

    successResponse(res, 200, 'Razorpay order created', {
      razorpayOrderId : rzpOrder.id,
      amount          : rzpOrder.amount,
      currency        : rzpOrder.currency,
      keyId           : process.env.RAZORPAY_KEY_ID,
      orderNumber     : order.orderNumber,
    });
  } catch (err) { next(err); }
};

/* ── VERIFY RAZORPAY PAYMENT ── */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    /* Verify signature */
    const body      = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return errorResponse(res, 400, 'Payment verification failed — invalid signature');
    }

    const order = await Order.findOne({ _id:orderId, user:req.user._id }).populate('user','email firstName');
    if (!order) return errorResponse(res, 404, 'Order not found');

    order.payment.status            = 'paid';
    order.payment.razorpayPaymentId = razorpay_payment_id;
    order.payment.razorpaySignature = razorpay_signature;
    order.payment.paidAt            = new Date();
    order.status                    = 'processing';
    order.statusHistory.push({ status:'processing', message:'Payment confirmed. Order being processed.' });
    await order.save();

    /* Payment success email */
    await sendEmail(
      order.user.email,
      `✅ Payment Confirmed — Paddox Order #${order.orderNumber}`,
      `<h2>Payment Received!</h2><p>Hi ${order.user.firstName}, your payment of <strong>₹${order.pricing.total.toLocaleString('en-IN')}</strong> has been confirmed for order <strong>#${order.orderNumber}</strong>.</p>`
    );

    /* Notify admin */
    try { getIO().emit('admin:payment-received', { orderNumber: order.orderNumber, total: order.pricing.total }); } catch {}

    successResponse(res, 200, 'Payment verified successfully', { order });
  } catch (err) { next(err); }
};

/* ── GET PAYMENT HISTORY ── */
exports.getPaymentHistory = async (req, res, next) => {
  try {
    const orders = await Order.find({ user:req.user._id, 'payment.status':'paid' })
      .select('orderNumber pricing.total payment.paidAt payment.razorpayPaymentId createdAt')
      .sort('-payment.paidAt');
    successResponse(res, 200, 'Payment history fetched', { orders });
  } catch (err) { next(err); }
};

/* ── INITIATE REFUND (admin) ── */
exports.initiateRefund = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId).populate('user','email firstName');
    if (!order) return errorResponse(res, 404, 'Order not found');
    if (order.payment.status !== 'paid') return errorResponse(res, 400, 'Order not paid — cannot refund');

    await razorpay.payments.refund(order.payment.razorpayPaymentId, {
      amount: order.pricing.total * 100,
      notes : { reason: req.body.reason || 'Refund initiated by admin' },
    });

    order.payment.status = 'refunded';
    order.status         = 'refunded';
    order.statusHistory.push({ status:'refunded', message: req.body.reason || 'Refund processed' });
    await order.save();

    await sendEmail(
      order.user.email,
      `💰 Refund Initiated — Paddox Order #${order.orderNumber}`,
      `<p>Hi ${order.user.firstName}, a refund of <strong>₹${order.pricing.total.toLocaleString('en-IN')}</strong> has been initiated for order <strong>#${order.orderNumber}</strong>. It will reflect in 5–7 business days.</p>`
    );

    successResponse(res, 200, 'Refund initiated successfully', { order });
  } catch (err) { next(err); }
};

