
/* ============================================================
   FILE: routes/f1.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const f1      = require('../controllers/f1.controller');
const { f1Limiter } = require('../middleware/rateLimit.middleware');

router.use(f1Limiter);
router.get('/sessions',                 f1.getSessions);
router.get('/drivers',                  f1.getDrivers);
router.get('/drivers/all',              f1.getAllDrivers);
router.get('/standings/drivers',        f1.getDriverStandings);
router.get('/standings/constructors',   f1.getConstructorStandings);
router.get('/schedule',                 f1.getSchedule);
router.get('/results/:round',           f1.getRaceResults);
router.get('/next-race',                f1.getNextRace);
router.get('/last-result',              f1.getLastResult);
router.get('/live',                     f1.getLiveSession);

module.exports = router;
