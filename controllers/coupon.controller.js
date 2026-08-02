/* ============================================================
   FILE: controllers/coupon.controller.js
   PADDOX — Coupon Code Controller
   ============================================================ */
const Coupon = require('../models/Coupon');

function ok(res, status, message, data = {}) {
  return res.status(status).json({ success: true, message, ...data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function normaliseCouponBody(body = {}) {
  const payload = {};

  if (body.code !== undefined) payload.code = String(body.code || '').trim().toUpperCase();
  if (body.title !== undefined) payload.title = String(body.title || '').trim();
  if (body.description !== undefined) payload.description = String(body.description || '').trim();
  if (body.type !== undefined) payload.type = String(body.type || 'percent').toLowerCase();
  if (body.value !== undefined) payload.value = Number(body.value);
  if (body.minOrderValue !== undefined) payload.minOrderValue = Number(body.minOrderValue || 0);
  if (body.maxUses !== undefined) payload.maxUses = Number(body.maxUses || 0);
  if (body.audience !== undefined) payload.audience = String(body.audience || 'all').toLowerCase();
  if (body.isActive !== undefined) payload.isActive = body.isActive === true || body.isActive === 'true';
  if (body.expiresAt !== undefined) payload.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  return payload;
}

function validateCouponPayload(payload = {}, partial = false) {
  if (!partial || payload.code !== undefined) {
    if (!payload.code || payload.code.length < 3) return 'Coupon code must be at least 3 characters';
    if (!/^[A-Z0-9_-]+$/.test(payload.code)) return 'Coupon code can use only letters, numbers, hyphen and underscore';
  }

  if (!partial || payload.type !== undefined) {
    if (!['percent', 'fixed'].includes(payload.type)) return 'Invalid coupon discount type';
  }

  if (!partial || payload.value !== undefined) {
    if (!Number.isFinite(Number(payload.value)) || Number(payload.value) <= 0) return 'Discount value must be greater than 0';
    if (payload.type === 'percent' && Number(payload.value) > 90) return 'Percentage discount cannot exceed 90%';
  }

  if (payload.minOrderValue !== undefined && Number(payload.minOrderValue) < 0) return 'Minimum order value cannot be negative';
  if (payload.maxUses !== undefined && Number(payload.maxUses) < 0) return 'Maximum uses cannot be negative';
  if (payload.audience !== undefined && !['all', 'fans', 'new_users', 'vip'].includes(payload.audience)) return 'Invalid coupon audience';

  return null;
}

exports.getAdminCoupons = async (req, res, next) => {
  try {
    const coupons = await Coupon.find().sort('-createdAt');
    return ok(res, 200, 'Coupons fetched', { data: coupons, coupons });
  } catch (err) { next(err); }
};

exports.createCoupon = async (req, res, next) => {
  try {
    const payload = normaliseCouponBody(req.body);
    payload.createdBy = req.user?._id || null;

    const error = validateCouponPayload(payload, false);
    if (error) return fail(res, 400, error);

    const exists = await Coupon.findOne({ code: payload.code });
    if (exists) return fail(res, 409, 'Coupon code already exists');

    const coupon = await Coupon.create(payload);
    return ok(res, 201, 'Coupon created', { data: coupon, coupon });
  } catch (err) { next(err); }
};

exports.updateCoupon = async (req, res, next) => {
  try {
    const payload = normaliseCouponBody(req.body);
    const existing = await Coupon.findById(req.params.id);
    if (!existing) return fail(res, 404, 'Coupon not found');

    const merged = {
      type: payload.type ?? existing.type,
      value: payload.value ?? existing.value,
      code: payload.code ?? existing.code,
      minOrderValue: payload.minOrderValue ?? existing.minOrderValue,
      maxUses: payload.maxUses ?? existing.maxUses,
      audience: payload.audience ?? existing.audience
    };

    const error = validateCouponPayload(merged, false);
    if (error) return fail(res, 400, error);

    if (payload.code && payload.code !== existing.code) {
      const duplicate = await Coupon.findOne({ code: payload.code, _id: { $ne: existing._id } });
      if (duplicate) return fail(res, 409, 'Coupon code already exists');
    }

    Object.assign(existing, payload);
    await existing.save();

    return ok(res, 200, 'Coupon updated', { data: existing, coupon: existing });
  } catch (err) { next(err); }
};

exports.deleteCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return fail(res, 404, 'Coupon not found');
    return ok(res, 200, 'Coupon deleted');
  } catch (err) { next(err); }
};

exports.validateCoupon = async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const orderTotal = Number(req.body.orderTotal || req.body.total || 0);

    if (!code) return fail(res, 400, 'Coupon code is required');
    if (!orderTotal || orderTotal <= 0) return fail(res, 400, 'Valid order total is required');

    const coupon = await Coupon.findOne({ code });
    if (!coupon) return fail(res, 404, 'Invalid coupon code');
    if (!coupon.isActive) return fail(res, 400, 'Coupon is inactive');
    if (coupon.isExpired()) return fail(res, 400, 'Coupon has expired');
    if (coupon.isUsageLimitReached()) return fail(res, 400, 'Coupon usage limit reached');
    if (coupon.minOrderValue && orderTotal < coupon.minOrderValue) {
      return fail(res, 400, `Minimum order value is ₹${coupon.minOrderValue}`);
    }

    const discount = coupon.calculateDiscount(orderTotal);
    const payable = Math.max(0, orderTotal - discount);

    return ok(res, 200, 'Coupon applied', {
      coupon: {
        id: coupon._id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount,
        minOrderValue: coupon.minOrderValue,
        audience: coupon.audience
      },
      pricing: {
        subtotal: orderTotal,
        discount,
        total: payable
      }
    });
  } catch (err) { next(err); }
};

exports.markCouponUsed = async (code) => {
  if (!code) return null;
  return Coupon.findOneAndUpdate(
    { code: String(code).trim().toUpperCase() },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
};
