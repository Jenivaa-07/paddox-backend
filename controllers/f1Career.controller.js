/* ============================================================
   PADDOX — F1 Career Stats Controller
   Supplies career totals without replacing current-season stats.
   ============================================================ */
const axios = require('axios');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

function clean(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function resolveCurrentDriver(identifier = '') {
  const key = clean(identifier);
  if (!key) return null;

  const cachedDrivers = cache.get('current_drivers');
  let drivers = cachedDrivers && Date.now() - cachedDrivers.ts < CACHE_TTL
    ? cachedDrivers.data
    : null;

  if (!drivers) {
    const response = await axios.get(`${JOLPICA_BASE}/current/drivers.json`, {
      params: { limit: 100 },
      timeout: 10000,
      headers: { Accept: 'application/json' }
    });
    drivers = response.data?.MRData?.DriverTable?.Drivers || [];
    cache.set('current_drivers', { data: drivers, ts: Date.now() });
  }

  return drivers.find(driver => {
    const fullName = `${driver.givenName || ''} ${driver.familyName || ''}`.trim();
    const values = [driver.driverId, driver.code, driver.permanentNumber, fullName];
    return values.some(value => clean(value) === key);
  }) || null;
}

async function fetchCareerWins(driverId = '') {
  const cacheKey = `career_wins:${driverId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const response = await axios.get(
    `${JOLPICA_BASE}/drivers/${encodeURIComponent(driverId)}/results/1.json`,
    {
      params: { limit: 1 },
      timeout: 10000,
      headers: { Accept: 'application/json' }
    }
  );

  const wins = Number(response.data?.MRData?.total || 0) || 0;
  cache.set(cacheKey, { data: wins, ts: Date.now() });
  return wins;
}

exports.getDriverCareer = async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || '').trim();
    if (!identifier || identifier.length > 80) {
      return errorResponse(res, 400, 'Invalid driver identifier');
    }

    const driver = await resolveCurrentDriver(identifier);
    if (!driver?.driverId) {
      return errorResponse(res, 404, 'Current-grid driver not found');
    }

    const wins = await fetchCareerWins(driver.driverId);

    return successResponse(res, 200, 'Driver career stats fetched', {
      driver: {
        id: driver.driverId,
        code: driver.code || '',
        number: driver.permanentNumber || '',
        name: `${driver.givenName || ''} ${driver.familyName || ''}`.trim()
      },
      career: { wins }
    });
  } catch (err) {
    if (err?.response?.status === 404) {
      return errorResponse(res, 404, 'Driver career stats not found');
    }
    next(err);
  }
};
