
/* ============================================================
   FILE: routes/admin.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const admin   = require('../controllers/admin.controller');
const DigitalAsset = require('../models/DigitalAsset');
const { protect, adminOnly } = require('../middleware/auth.middleware');

router.use(protect, adminOnly);

/* Dashboard */
router.get('/stats',                    admin.getDashboardStats);

/* Users */
router.get('/users',                    admin.getUsers);
router.put('/users/:id/role',           admin.changeRole);
router.put('/users/:id/ban',            admin.toggleBan);

/* Inventory */
router.get('/inventory',                admin.getInventory);
router.put('/inventory/:id',            admin.updateStock);

/* Digital Assets — Admin sees both published and paused wallpapers. */
router.get('/assets', async (req, res, next) => {
  try {
    const assets = await DigitalAsset.find().sort('-createdAt').select('-__v').lean();
    return res.status(200).json({
      success: true,
      message: 'Admin assets fetched',
      count: assets.length,
      data: { assets },
      assets
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/assets/:id/status', async (req, res, next) => {
  try {
    const isActive = req.body?.isActive === true || req.body?.isActive === 'true';
    const asset = await DigitalAsset.findByIdAndUpdate(
      req.params.id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).select('-__v');

    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    return res.status(200).json({
      success: true,
      message: isActive ? 'Asset published' : 'Asset paused',
      data: { asset },
      asset
    });
  } catch (err) {
    return next(err);
  }
});

/* Moderation */
router.get('/moderation',               admin.getModerationQueue);
router.put('/moderation',               admin.moderateContent);

/* Newsletter */
router.post('/newsletter/send',         admin.sendNewsletter);

/* Fan Zone */
router.post('/poll',                    admin.createPoll);
router.post('/trivia',                  admin.createTrivia);

module.exports = router;

