/* ============================================================
   PADDOX — Admin Product Catalogue Controller
   Dedicated protected catalogue feed for the Admin dashboard.
   ============================================================ */
const Product = require('../models/Product');
const { paginatedResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'Admin product query failed') {
  console.error(label, err);
  return res.status(500).json({ success:false, message:err.message || label });
}

exports.getAdminProducts = async (req, res) => {
  try {
    const {
      category,
      team,
      onSale,
      featured,
      active,
      search,
      sort = 'newest',
      page = 1,
      limit = 200
    } = req.query;

    const query = {};

    if (category && category !== 'all') query.category = String(category).toLowerCase();
    if (team && team !== 'all') query.team = new RegExp(String(team), 'i');
    if (onSale === 'true') query.onSale = true;
    if (onSale === 'false') query.onSale = { $ne:true };
    if (featured === 'true') query.isFeatured = true;
    if (active === 'true') query.isActive = true;
    if (active === 'false') query.isActive = false;

    if (search) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name:rx },
        { team:rx },
        { category:rx },
        { sku:rx },
        { description:rx }
      ];
    }

    const sortMap = {
      newest: { createdAt:-1 },
      oldest: { createdAt:1 },
      'price-asc': { price:1 },
      'price-desc': { price:-1 },
      stock: { stock:1 },
      featured: { isFeatured:-1, createdAt:-1 }
    };

    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);
    const total = await Product.countDocuments(query);
    const products = await Product.find(query)
      .sort(sortMap[sort] || sortMap.newest)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .select('-__v');

    return paginatedResponse(res, products, safePage, safeLimit, total);
  } catch (err) {
    return serverError(res, err);
  }
};
