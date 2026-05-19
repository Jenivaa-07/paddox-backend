
/* ============================================================
   FILE: controllers/f1.controller.js
   ============================================================ */
const { successResponse, errorResponse } = require('../utils/apiResponse');
const {
  getOpenF1Sessions, getOpenF1Drivers, getOpenF1Laps,
  getOpenF1Position, getOpenF1CarData, getOpenF1Weather,
  getErgastSchedule, getErgastDriverStand, getErgastConsStand,
  getErgastResults,  getErgastDrivers,     getErgastNextRace, getErgastLastResult,
} = require('../utils/f1Api');
const { getIO } = require('../config/socket');

/* In-memory cache to reduce API calls */
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const withCache = async (key, fetcher) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const data = await fetcher();
  cache.set(key, { data, ts: Date.now() });
  return data;
};

/* ── GET SESSIONS (OpenF1) ── */
exports.getSessions = async (req, res, next) => {
  try {
    const data = await withCache('sessions', async () => {
      const r = await getOpenF1Sessions({ year: req.query.year || 2025 });
      return r.data;
    });
    successResponse(res, 200, 'Sessions fetched', { sessions: data });
  } catch (err) { next(err); }
};

/* ── GET DRIVERS (OpenF1) ── */
exports.getDrivers = async (req, res, next) => {
  try {
    const data = await withCache('drivers_openf1', async () => {
      const r = await getOpenF1Drivers({ session_key: 'latest' });
      return r.data;
    });
    successResponse(res, 200, 'Drivers fetched', { drivers: data });
  } catch (err) { next(err); }
};

/* ── DRIVER CHAMPIONSHIP STANDINGS (Ergast) ── */
exports.getDriverStandings = async (req, res, next) => {
  try {
    const year = req.query.year || 'current';
    const data = await withCache(`driver_standings_${year}`, async () => {
      const r = await getErgastDriverStand(year);
      return r.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
    });
    successResponse(res, 200, 'Driver standings fetched', { standings: data });
  } catch (err) { next(err); }
};

/* ── CONSTRUCTOR STANDINGS (Ergast) ── */
exports.getConstructorStandings = async (req, res, next) => {
  try {
    const year = req.query.year || 'current';
    const data = await withCache(`cons_standings_${year}`, async () => {
      const r = await getErgastConsStand(year);
      return r.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
    });
    successResponse(res, 200, 'Constructor standings fetched', { standings: data });
  } catch (err) { next(err); }
};

/* ── RACE SCHEDULE (Ergast) ── */
exports.getSchedule = async (req, res, next) => {
  try {
    const year = req.query.year || 'current';
    const data = await withCache(`schedule_${year}`, async () => {
      const r = await getErgastSchedule(year);
      return r.data?.MRData?.RaceTable?.Races || [];
    });
    successResponse(res, 200, 'Race schedule fetched', { races: data });
  } catch (err) { next(err); }
};

/* ── RACE RESULTS (Ergast) ── */
exports.getRaceResults = async (req, res, next) => {
  try {
    const { round } = req.params;
    const year      = req.query.year || 'current';
    const data = await withCache(`results_${year}_${round}`, async () => {
      const r = await getErgastResults(year, round);
      return r.data?.MRData?.RaceTable?.Races?.[0] || {};
    });
    successResponse(res, 200, 'Race results fetched', { race: data });
  } catch (err) { next(err); }
};

/* ── NEXT RACE (Ergast) ── */
/* ── NEXT RACE (Mock Data) ── */
exports.getNextRace = async (req, res, next) => {
  try {

    const data = {
      race: {
        round: 8,
        raceName: "Monaco Grand Prix",
        circuit: "Circuit de Monaco",
        country: "Monaco",
        date: "2026-05-25",
        time: "14:00:00Z"
      },

      countdown: {
        days: 5,
        hours: 12,
        minutes: 30,
        seconds: 15
      }
    };

    successResponse(res, 200, 'Next race fetched', data);

  } catch (err) {
    next(err);
  }
};

/* ── LIVE SESSION DATA (OpenF1) ── */
exports.getLiveSession = async (req, res, next) => {
  try {
    const [positions, intervals, weather] = await Promise.all([
      getOpenF1Position({ session_key:'latest' }),
      getOpenF1Drivers({ session_key:'latest' }),
      getOpenF1Weather({ session_key:'latest' }),
    ]);
    const liveData = {
      positions : positions.data?.slice(0, 20) || [],
      drivers   : intervals.data?.slice(0, 20) || [],
      weather   : weather.data?.[weather.data.length - 1] || {},
      fetchedAt : new Date().toISOString(),
    };
    /* Broadcast to race room via WebSocket */
    try { getIO().to('race:live').emit('race:session-update', liveData); } catch {}
    successResponse(res, 200, 'Live session data fetched', liveData);
  } catch (err) { next(err); }
};

/* ── ALL DRIVERS (Ergast) ── */
exports.getAllDrivers = async (req, res, next) => {
  try {
    const data = await withCache('all_drivers', async () => {
      const r = await getErgastDrivers('current');
      return r.data?.MRData?.DriverTable?.Drivers || [];
    });
    successResponse(res, 200, 'All drivers fetched', { drivers: data });
  } catch (err) { next(err); }
};

/* ── LAST RACE RESULT (Ergast) ── */
exports.getLastResult = async (req, res, next) => {
  try {
    const data = await withCache('last_result', async () => {
      const r = await getErgastLastResult();
      return r.data?.MRData?.RaceTable?.Races?.[0] || {};
    });
    successResponse(res, 200, 'Last race result fetched', { race: data });
  } catch (err) { next(err); }
};
