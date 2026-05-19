
/* ============================================================
   FILE: routes/admin.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const admin   = require('../controllers/admin.controller');
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

/* Moderation */
router.get('/moderation',               admin.getModerationQueue);
router.put('/moderation',               admin.moderateContent);

/* Newsletter */
router.post('/newsletter/send',         admin.sendNewsletter);

/* Fan Zone */
router.post('/poll',                    admin.createPoll);
router.post('/trivia',                  admin.createTrivia);

module.exports = router;

