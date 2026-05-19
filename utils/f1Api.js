/* ============================================================
   FILE: utils/f1Api.js  —  OpenF1 + Ergast API Helpers
   ============================================================ */
const axios = require('axios');

const openF1  = axios.create({ baseURL: process.env.OPENF1_BASE_URL, timeout: 10000 });
const ergast  = axios.create({ baseURL: process.env.ERGAST_BASE_URL, timeout: 10000 });

/* ── OpenF1 helpers ── */
const getOpenF1Sessions  = (params={}) => openF1.get('/sessions', { params });
const getOpenF1Drivers   = (params={}) => openF1.get('/drivers',  { params });
const getOpenF1Laps      = (params={}) => openF1.get('/laps',     { params });
const getOpenF1Position  = (params={}) => openF1.get('/position', { params });
const getOpenF1CarData   = (params={}) => openF1.get('/car_data', { params });
const getOpenF1Weather   = (params={}) => openF1.get('/weather',  { params });
const getOpenF1Intervals = (params={}) => openF1.get('/intervals',{ params });

/* ── Ergast helpers ── */
const getErgastSchedule    = (year='current')          => ergast.get(`/${year}.json`);
const getErgastDriverStand = (year='current')          => ergast.get(`/${year}/driverStandings.json`);
const getErgastConsStand   = (year='current')          => ergast.get(`/${year}/constructorStandings.json`);
const getErgastResults     = (year='current', round)   => ergast.get(`/${year}/${round}/results.json`);
const getErgastDrivers     = (year='current')          => ergast.get(`/${year}/drivers.json`);
const getErgastNextRace    = ()                        => ergast.get('/current/next.json');
const getErgastLastResult  = ()                        => ergast.get('/current/last/results.json');

module.exports = {
  getOpenF1Sessions, getOpenF1Drivers, getOpenF1Laps,
  getOpenF1Position, getOpenF1CarData, getOpenF1Weather, getOpenF1Intervals,
  getErgastSchedule, getErgastDriverStand, getErgastConsStand,
  getErgastResults,  getErgastDrivers,     getErgastNextRace, getErgastLastResult,
};

