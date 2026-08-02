const express = require('express');
const router = express.Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth.middleware');
const { uploadLimiter } = require('../middleware/rateLimit.middleware');

const CollectibleDefinition = require('../models/CollectibleDefinition');
const UserCollectible = require('../models/UserCollectible');
const CollectibleAuditLog = require('../models/CollectibleAuditLog');
const CollectibleService = require('../services/collectible.service');
const artworkController = require('../controllers/collectibleArtwork.controller');

/* Strict rate limiter for artwork uploads: 10 per hour per IP */
const artworkLimiter = rateLimit({
  windowMs : 60 * 60 * 1000,
  max      : 10,
  message  : { success: false, message: 'Too many artwork uploads. Try again later.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

/* Multer: memory storage, strict filter, 5MB cap */
const artworkUpload = multer({
  storage  : multer.memoryStorage(),
  limits   : { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
    // Reject SVG by mimetype before buffer inspection
    if (file.mimetype === 'image/svg+xml') {
      return cb(new Error('SVG files are not permitted'));
    }
    cb(null, true);
  },
});


// -----------------------------------------------------
// STATIC ROUTES MUST BE DEFINED BEFORE PARAMETERIZED ONES
// -----------------------------------------------------

/**
 * GET /api/collectibles/me
 * @desc Get logged in user's collectibles
 */
router.get('/me', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    
    const collectibles = await UserCollectible.find({ userId: req.user._id })
      .populate('collectibleDefinitionId', 'slug name rarity imageUrl season')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
      
    res.json({ success: true, data: collectibles });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/admin/collectibles/audit
 * @desc Get audit logs for collectibles (Admin only)
 */
router.get('/audit', protect, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    
    const logs = await CollectibleAuditLog.find()
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
      
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// -----------------------------------------------------
// PARAMETERIZED ROUTES (/verify/:id, /me/:id, etc)
// -----------------------------------------------------

/**
 * GET /api/collectibles/verify/:publicCertificateId
 * @desc Verify a public certificate (scrubs PII)
 */
router.get('/verify/:publicCertificateId', async (req, res) => {
  try {
    const coll = await UserCollectible.findOne({ publicCertificateId: req.params.publicCertificateId })
      .populate('collectibleDefinitionId', 'slug name rarity');
      
    if (!coll || !coll.shareEnabled) {
      return res.status(404).json({ success: false, message: 'Certificate not found or private.' });
    }
    
    let fingerprintMatches = null;
    const providedFingerprint = req.query.fingerprint;
    if (providedFingerprint && typeof providedFingerprint === 'string') {
       try {
           const crypto = require('crypto');
           const expectedBuf = Buffer.from(coll.certificateFingerprint, 'hex');
           const providedBuf = Buffer.from(providedFingerprint, 'hex');
           if (expectedBuf.length === providedBuf.length) {
               fingerprintMatches = crypto.timingSafeEqual(expectedBuf, providedBuf);
           } else {
               fingerprintMatches = false;
           }
       } catch (e) {
           fingerprintMatches = false;
       }
    }

    const responseData = {
      slug: coll.collectibleDefinitionId.slug,
      name: coll.collectibleDefinitionId.name,
      rarity: coll.collectibleDefinitionId.rarity,
      issuedDate: coll.issuedAt,
      editionNumber: coll.editionNumber,
      verificationFingerprint: coll.certificateFingerprint,
      fingerprintVersion: coll.fingerprintVersion,
      blockchainStatus: 'off_chain',
      status: coll.status === 'revoked' ? 'revoked' : 'valid'
    };
    
    if (fingerprintMatches !== null) {
      responseData.fingerprintMatches = fingerprintMatches;
    }
    
    res.json({ success: true, data: responseData });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/collectibles/me/:id
 * @desc Get detailed specific owned collectible (IDOR protected)
 */
router.get('/me/:id', protect, async (req, res) => {
  try {
    const coll = await UserCollectible.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('collectibleDefinitionId');
      
    if (!coll) {
      return res.status(404).json({ success: false, message: 'Not found or not owned.' });
    }
    
    res.json({ success: true, data: coll });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * PATCH /api/collectibles/me/:id/sharing
 * @desc Toggle certificate sharing
 */
router.patch('/me/:id/sharing', protect, async (req, res) => {
  try {
    const { shareEnabled } = req.body;
    if (typeof shareEnabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'shareEnabled must be boolean' });
    }
    
    const coll = await UserCollectible.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { shareEnabled },
      { new: true }
    );
    
    if (!coll) {
      return res.status(404).json({ success: false, message: 'Not found or not owned.' });
    }
    
    res.json({ success: true, data: coll });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/collectibles
 * @desc List active collectible definitions (Catalogue)
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const defs = await CollectibleDefinition.find({ active: true }).lean();
    res.json({ success: true, data: defs });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/collectibles/:slug
 * @desc Get collectible definition detail
 */
router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    // Prevent catching /audit or /me if route ordering fails
    if (['me', 'verify', 'audit'].includes(req.params.slug)) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const def = await CollectibleDefinition.findOne({ slug: req.params.slug, active: true }).lean();
    if (!def) {
      return res.status(404).json({ success: false, message: 'Collectible not found.' });
    }
    res.json({ success: true, data: def });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// -----------------------------------------------------
// ADMIN MUTATION ROUTES
// -----------------------------------------------------

/**
 * POST /api/admin/collectibles
 * @desc Create new collectible definition
 */
router.post('/admin/definitions', protect, adminOnly, uploadLimiter, async (req, res) => {
  try {
    const def = new CollectibleDefinition({
      ...req.body,
      createdBy: req.user._id
    });
    await def.save();
    
    const auditLog = new CollectibleAuditLog({
      actorId: req.user._id,
      actorType: 'admin',
      action: 'created_definition',
      collectibleDefinitionId: def._id,
      reason: 'Admin creation',
      sanitizedMetadata: { slug: def.slug }
    });
    await auditLog.save();
    
    res.status(201).json({ success: true, data: def });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Validation failed or duplicate slug' });
  }
});

/**
 * PATCH /api/admin/collectibles/:id
 * @desc Edit definition
 */
router.patch('/admin/definitions/:id', protect, adminOnly, uploadLimiter, async (req, res) => {
  try {
    const def = await CollectibleDefinition.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!def) return res.status(404).json({ success: false, message: 'Not found' });
    
    const auditLog = new CollectibleAuditLog({
      actorId: req.user._id,
      actorType: 'admin',
      action: 'updated_definition',
      collectibleDefinitionId: def._id,
      reason: 'Admin update',
      sanitizedMetadata: { updates: Object.keys(req.body) }
    });
    await auditLog.save();
    
    res.json({ success: true, data: def });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Update failed' });
  }
});

/**
 * POST /api/admin/collectibles/:id/issue
 * @desc Manually issue collectible to user
 */
router.post('/admin/definitions/:id/issue', protect, adminOnly, uploadLimiter, async (req, res) => {
  try {
    const { userId, reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Mandatory reason required for manual issuance.' });
    }
    
    const result = await CollectibleService.issueCollectible({
      userId,
      definitionId: req.params.id,
      eligibilityRuleVersion: 'v1',
      issuanceReason: reason,
      evidenceType: 'manual',
      trustedEventReference: `admin_${req.user._id}_${Date.now()}`,
      actorId: req.user._id,
      actorType: 'admin'
    });
    
    if (result.status !== 'issued') {
      return res.status(400).json({ success: false, message: `Issuance failed: ${result.status}` });
    }
    
    res.status(201).json({ success: true, data: result.userCollectible });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/admin/user-collectibles/:id/revoke
 * @desc Revoke an issued collectible
 */
router.post('/admin/user-collectibles/:id/revoke', protect, adminOnly, uploadLimiter, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Mandatory reason required for revocation.' });
    }
    
    const coll = await UserCollectible.findById(req.params.id);
    if (!coll) return res.status(404).json({ success: false, message: 'Not found' });
    
    coll.status = 'revoked';
    coll.revokedAt = new Date();
    coll.revokedBy = req.user._id;
    coll.revocationReason = reason;
    await coll.save();
    
    const auditLog = new CollectibleAuditLog({
      actorId: req.user._id,
      actorType: 'admin',
      action: 'revoked',
      collectibleDefinitionId: coll.collectibleDefinitionId,
      userCollectibleId: coll._id,
      reason,
      sanitizedMetadata: { revocation: true }
    });
    await auditLog.save();
    
    res.json({ success: true, data: coll });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/collectibles/admin/artwork
 * @desc Secure admin-only collectible artwork upload to Cloudinary
 * - Admin role required
 * - Rate limited (10/hour)
 * - JPEG/PNG/WebP only, 5MB max
 * - MIME + extension + magic-byte validation in controller
 * - SVG/polyglot rejected
 * - Generated public IDs, paddox/collectibles folder
 */
router.post(
  '/admin/artwork',
  protect,
  adminOnly,
  artworkLimiter,
  artworkUpload.single('artwork'),
  artworkController.uploadCollectibleArtwork
);

module.exports = router;
