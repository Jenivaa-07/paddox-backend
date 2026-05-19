

/* ============================================================
   FILE: controllers/admin.controller.js
   ============================================================ */
const User       = require('../models/User');
const Product    = require('../models/Product');
const Order      = require('../models/Order');
const FanPost    = require('../models/FanPost');
const Review     = require('../models/Review');
const Newsletter = require('../models/Newsletter');
const Poll       = require('../models/Poll');
const Trivia     = require('../models/Trivia');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');

/* ── DASHBOARD STATS ── */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalUsers, totalOrders, totalProducts,
      totalRevenue, recentOrders, lowStock,
      pendingModeration,
    ] = await Promise.all([
      User.countDocuments({ isBanned:false }),
      Order.countDocuments(),
      Product.countDocuments({ isActive:true }),
      Order.aggregate([{ $match:{ 'payment.status':'paid' } }, { $group:{ _id:null, total:{ $sum:'$pricing.total' } } }]),
      Order.find().sort('-createdAt').limit(5).populate('user','firstName lastName email'),
      Product.find({ stock:{ $lt:10 }, isActive:true }).select('name stock').limit(10),
      FanPost.countDocuments({ isFlagged:true, isApproved:true }) + await Review.countDocuments({ isFlagged:true }),
    ]);

    /* Monthly revenue (last 6 months) */
    const monthlyRevenue = await Order.aggregate([
      { $match: { 'payment.status':'paid', createdAt:{ $gte: new Date(Date.now() - 180*24*60*60*1000) } } },
      { $group: { _id:{ $month:'$createdAt' }, revenue:{ $sum:'$pricing.total' }, count:{ $sum:1 } } },
      { $sort: { '_id':1 } },
    ]);

    successResponse(res, 200, 'Dashboard stats fetched', {
      stats: {
        totalUsers,
        totalOrders,
        totalProducts,
        totalRevenue  : totalRevenue[0]?.total || 0,
        pendingModeration,
      },
      recentOrders,
      lowStock,
      monthlyRevenue,
    });
  } catch (err) { next(err); }
};

/* ── GET ALL USERS ── */
exports.getUsers = async (req, res, next) => {
  try {
    const { page=1, limit=20, search, role, tier } = req.query;
    const query = {};
    if (search) query.$or = [{ firstName:new RegExp(search,'i') }, { email:new RegExp(search,'i') }];
    if (role)   query.role    = role;
    if (tier)   query.fanTier = tier;

    const total = await User.countDocuments(query);
    const users = await User.find(query).sort('-createdAt').skip((page-1)*limit).limit(Number(limit)).select('-password -refreshToken');
    paginatedResponse(res, users, page, limit, total);
  } catch (err) { next(err); }
};

/* ── BAN / UNBAN USER ── */
exports.toggleBan = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return errorResponse(res, 404, 'User not found');
    if (user.role === 'admin') return errorResponse(res, 403, 'Cannot ban an admin');
    user.isBanned = !user.isBanned;
    await user.save({ validateBeforeSave:false });
    successResponse(res, 200, `User ${user.isBanned?'banned':'unbanned'} successfully`, { isBanned:user.isBanned });
  } catch (err) { next(err); }
};

/* ── CHANGE USER ROLE ── */
exports.changeRole = async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user','admin'].includes(role)) return errorResponse(res, 400, 'Invalid role');
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new:true });
    if (!user) return errorResponse(res, 404, 'User not found');
    successResponse(res, 200, 'Role updated', { role:user.role });
  } catch (err) { next(err); }
};

/* ── GET INVENTORY ── */
exports.getInventory = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = { isActive:true };
    if (status === 'low')  query.stock = { $gt:0, $lt:10 };
    if (status === 'out')  query.stock = 0;
    if (status === 'ok')   query.stock = { $gte:10 };

    const products = await Product.find(query).select('name sku stock team category isLimited').sort('stock');
    successResponse(res, 200, 'Inventory fetched', { products, count:products.length });
  } catch (err) { next(err); }
};

/* ── UPDATE STOCK ── */
exports.updateStock = async (req, res, next) => {
  try {
    const { stock } = req.body;
    if (stock < 0) return errorResponse(res, 400, 'Stock cannot be negative');
    const product = await Product.findByIdAndUpdate(req.params.id, { stock }, { new:true });
    if (!product) return errorResponse(res, 404, 'Product not found');
    successResponse(res, 200, 'Stock updated', { product });
  } catch (err) { next(err); }
};

/* ── GET FLAGGED CONTENT ── */
exports.getModerationQueue = async (req, res, next) => {
  try {
    const [posts, reviews] = await Promise.all([
      FanPost.find({ isFlagged:true }).populate('user','firstName lastName email').sort('-createdAt'),
      Review.find({ isFlagged:true }).populate('user','firstName lastName email').populate('product','name').sort('-createdAt'),
    ]);
    successResponse(res, 200, 'Moderation queue fetched', { posts, reviews, total: posts.length + reviews.length });
  } catch (err) { next(err); }
};

/* ── APPROVE / REMOVE FLAGGED CONTENT ── */
exports.moderateContent = async (req, res, next) => {
  try {
    const { type, id, action } = req.body; // type: 'post'|'review', action: 'approve'|'remove'
    const Model = type === 'post' ? FanPost : Review;
    const item  = await Model.findById(id);
    if (!item) return errorResponse(res, 404, 'Content not found');

    if (action === 'approve') { item.isFlagged = false; item.isApproved = true; }
    if (action === 'remove')  { item.isApproved = false; }
    await item.save();

    successResponse(res, 200, `Content ${action}d successfully`);
  } catch (err) { next(err); }
};

/* ── SEND NEWSLETTER ── */
exports.sendNewsletter = async (req, res, next) => {
  try {
    const { subject, html } = req.body;
    const subscribers = await Newsletter.find({ isActive:true }).select('email');
    let sent = 0, failed = 0;

    for (const sub of subscribers) {
      const result = await sendEmail(sub.email, subject, html);
      result.success ? sent++ : failed++;
    }

    successResponse(res, 200, 'Newsletter sent', { sent, failed, total: subscribers.length });
  } catch (err) { next(err); }
};

/* ── CREATE POLL (admin) ── */
exports.createPoll = async (req, res, next) => {
  try {
    const { question, options, endsAt } = req.body;
    const poll = await Poll.create({
      question,
      options: options.map(label => ({ label, votes:0 })),
      endsAt,
      createdBy: req.user._id,
    });
    successResponse(res, 201, 'Poll created', { poll });
  } catch (err) { next(err); }
};

/* ── CREATE TRIVIA (admin) ── */
exports.createTrivia = async (req, res, next) => {
  try {
    const trivia = await Trivia.create({ ...req.body, createdBy:req.user._id });
    successResponse(res, 201, 'Trivia created', { trivia });
  } catch (err) { next(err); }
};

