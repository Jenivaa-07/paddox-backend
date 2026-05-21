/* ============================================================
   FILE: utils/f1Api.js
   F1 Data — OpenF1 (real-time) + Jolpica/Ergast (season data)
   Both FREE, no API key needed, auto-updates every season
   ============================================================ */
const axios = require('axios');

/* ── API Clients ── */
const openF1 = axios.create({
  baseURL: process.env.OPENF1_BASE_URL || 'https://api.openf1.org/v1',
  timeout: 10000,
  headers: { 'Accept': 'application/json' }
});

const jolpica = axios.create({
  baseURL: 'https://api.jolpi.ca/ergast/f1',
  timeout: 10000,
  headers: { 'Accept': 'application/json' }
});

/* ── OpenF1 Endpoints ── */
const getOpenF1Sessions  = (params = {}) => openF1.get('/sessions',  { params });
const getOpenF1Drivers   = (params = {}) => openF1.get('/drivers',   { params });
const getOpenF1Laps      = (params = {}) => openF1.get('/laps',      { params });
const getOpenF1Position  = (params = {}) => openF1.get('/position',  { params });
const getOpenF1Weather   = (params = {}) => openF1.get('/weather',   { params });
const getOpenF1Intervals = (params = {}) => openF1.get('/intervals', { params });
const getOpenF1CarData   = (params = {}) => openF1.get('/car_data',  { params });

/* ── Jolpica/Ergast Endpoints (auto-detects current year) ── */
const getCurrentYear     = ()            => new Date().getFullYear();
const getSchedule        = (year = getCurrentYear()) => jolpica.get(`/${year}.json`);
const getDriverStandings = (year = getCurrentYear()) => jolpica.get(`/${year}/driverStandings.json`);
const getConsStandings   = (year = getCurrentYear()) => jolpica.get(`/${year}/constructorStandings.json`);
const getRaceResults     = (year = getCurrentYear(), round) => jolpica.get(`/${year}/${round}/results.json`);
const getNextRace        = ()            => jolpica.get('/current/next.json');
const getLastResult      = ()            => jolpica.get('/current/last/results.json');
const getDrivers         = (year = getCurrentYear()) => jolpica.get(`/${year}/drivers.json`);
const getQualifying      = (year = getCurrentYear(), round) => jolpica.get(`/${year}/${round}/qualifying.json`);

module.exports = {
  /* OpenF1 */
  getOpenF1Sessions, getOpenF1Drivers, getOpenF1Laps,
  getOpenF1Position, getOpenF1Weather, getOpenF1Intervals, getOpenF1CarData,
  /* Jolpica/Ergast */
  getSchedule, getDriverStandings, getConsStandings,
  getRaceResults, getNextRace, getLastResult,
  getDrivers, getQualifying, getCurrentYear,
};