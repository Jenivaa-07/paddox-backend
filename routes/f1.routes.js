/* ============================================================
   FILE: routes/f1.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const f1      = require('../controllers/f1.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { f1Limiter } = require('../middleware/rateLimit.middleware');

router.use(f1Limiter);

router.get('/next-race',              f1.getNextRace);
router.get('/schedule',               f1.getSchedule);
router.get('/standings/drivers',      f1.getDriverStandings);
router.get('/standings/constructors', f1.getConstructorStandings);
router.get('/results/:round',         f1.getRaceResults);
router.get('/last-result',            f1.getLastResult);
router.get('/drivers/all',            f1.getAllDrivers);
router.get('/sessions',               f1.getSessions);
router.get('/live',                   f1.getLiveSession);
router.get('/pitwall/weekend',        f1.getPitWallWeekend);
router.get('/pitwall/session',        f1.getPitWallSession);
router.post('/cache/clear',           protect, adminOnly, f1.clearCache);

module.exports = router;