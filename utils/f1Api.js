/* ============================================================
   FILE: utils/f1Api.js
   F1 Data — OpenF1 + Jolpica
   Historical OpenF1 data is public; live access can require OAuth.
   ============================================================ */
const axios = require('axios');
const { openF1Request } = require('../services/openF1Client.service');

const jolpica = axios.create({
  baseURL: 'https://api.jolpi.ca/ergast/f1',
  timeout: 10000,
  headers: { 'Accept': 'application/json' }
});

function openF1AxiosShape(endpoint, params = {}, options = {}) {
  return openF1Request(endpoint, params, options).then(response => ({
    ...response,
    data: response.data
  }));
}

/* ── OpenF1 Endpoints ── */
const getOpenF1Sessions  = (params = {}, options = {}) => openF1AxiosShape('sessions',  params, options);
const getOpenF1Drivers   = (params = {}, options = {}) => openF1AxiosShape('drivers',   params, options);
const getOpenF1Laps      = (params = {}, options = {}) => openF1AxiosShape('laps',      params, options);
const getOpenF1Position  = (params = {}, options = {}) => openF1AxiosShape('position',  params, options);
const getOpenF1Weather   = (params = {}, options = {}) => openF1AxiosShape('weather',   params, options);
const getOpenF1Intervals = (params = {}, options = {}) => openF1AxiosShape('intervals', params, options);
const getOpenF1CarData   = (params = {}, options = {}) => openF1AxiosShape('car_data',  params, options);
const getOpenF1Location  = (params = {}, options = {}) => openF1AxiosShape('location',  params, options);
const getOpenF1Stints    = (params = {}, options = {}) => openF1AxiosShape('stints',    params, options);
const getOpenF1Pit       = (params = {}, options = {}) => openF1AxiosShape('pit',       params, options);
const getOpenF1RaceControl = (params = {}, options = {}) => openF1AxiosShape('race_control', params, options);
const getOpenF1Meetings  = (params = {}, options = {}) => openF1AxiosShape('meetings',  params, options);

/* ── Jolpica/Ergast Endpoints ── */
const getCurrentYear     = () => new Date().getFullYear();
const getSchedule        = (year = getCurrentYear()) => jolpica.get(`/${year}.json`);
const getDriverStandings = (year = getCurrentYear()) => jolpica.get(`/${year}/driverStandings.json`);
const getConsStandings   = (year = getCurrentYear()) => jolpica.get(`/${year}/constructorStandings.json`);
const getRaceResults     = (year = getCurrentYear(), round) => jolpica.get(`/${year}/${round}/results.json`);
const getNextRace        = () => jolpica.get('/current/next.json');
const getLastResult      = () => jolpica.get('/current/last/results.json');
const getDrivers         = (year = getCurrentYear()) => jolpica.get(`/${year}/drivers.json`);
const getQualifying      = (year = getCurrentYear(), round) => jolpica.get(`/${year}/${round}/qualifying.json`);

module.exports = {
  getOpenF1Sessions, getOpenF1Drivers, getOpenF1Laps,
  getOpenF1Position, getOpenF1Weather, getOpenF1Intervals, getOpenF1CarData,
  getOpenF1Location, getOpenF1Stints, getOpenF1Pit, getOpenF1RaceControl, getOpenF1Meetings,
  getSchedule, getDriverStandings, getConsStandings,
  getRaceResults, getNextRace, getLastResult,
  getDrivers, getQualifying, getCurrentYear,
};