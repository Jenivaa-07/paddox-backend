/* ============================================================
   FILE: controllers/f1.controller.js
   Handles all F1 data — live 2026 season, auto-updates
   ============================================================ */
const {
  getOpenF1Sessions, getOpenF1Drivers, getOpenF1Position,
  getOpenF1Weather, getOpenF1Laps,
  getSchedule, getDriverStandings, getConsStandings,
  getRaceResults, getNextRace, getLastResult,
  getDrivers, getQualifying, getCurrentYear,
} = require('../utils/f1Api');
const axios = require('axios');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');
let FanDriverProfile = null;
try { FanDriverProfile = require('../models/FanDriverProfile'); } catch (_) { FanDriverProfile = null; }

/* ── In-memory cache (reduces API calls) ── */
const cache = new Map();
const CACHE_TTL = {
  live     : 5   * 1000,   /* 5 seconds — true live/session data */
  standings: 15  * 60 * 1000, /* 15 minutes — standings update after race */
  schedule : 60  * 60 * 1000, /* 1 hour     — calendar rarely changes */
  results  : 60  * 60 * 1000, /* 1 hour     — past results never change */
  nextRace : 5   * 60 * 1000, /* 5 minutes  — countdown updates */
};

const withCache = async (key, fetcher, ttl = 5 * 60 * 1000) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;
  try {
    const data = await fetcher();
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    if (cached?.data) {
      return {
        ...cached.data,
        stale: true,
        staleReason: err.message || 'Fresh fetch failed; served last cached response'
      };
    }
    throw err;
  }
};

/* ── GET NEXT RACE + COUNTDOWN ── */
exports.getNextRace = async (req, res, next) => {
  try {
    const data = await withCache('next_race', async () => {
      const r    = await getNextRace();
      const race = r.data?.MRData?.RaceTable?.Races?.[0];
      if (!race) return { race: null, countdown: null };

      const raceDate  = new Date(`${race.date}T${race.time || '13:00:00Z'}`);
      const diff      = raceDate - Date.now();
      const countdown = diff > 0 ? {
        total  : diff,
        days   : Math.floor(diff / 864e5),
        hours  : Math.floor((diff % 864e5) / 36e5),
        minutes: Math.floor((diff % 36e5) / 6e4),
        seconds: Math.floor((diff % 6e4) / 1e3),
      } : { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

      return {
        race: {
          name      : race.raceName,
          round     : race.round,
          season    : race.season,
          date      : race.date,
          time      : race.time,
          circuit   : race.Circuit?.circuitName,
          location  : race.Circuit?.Location?.locality,
          country   : race.Circuit?.Location?.country,
          flag      : getFlagEmoji(race.Circuit?.Location?.country),
          sessions  : {
            fp1       : race.FirstPractice,
            fp2       : race.SecondPractice,
            fp3       : race.ThirdPractice,
            qualifying: race.Qualifying,
            sprint    : race.Sprint,
            race      : { date: race.date, time: race.time },
          }
        },
        countdown,
        raceDate: raceDate.toISOString(),
      };
    }, CACHE_TTL.nextRace);

    try {
      if (data?.race) {
        getIO().emit('race:notification', {
          title: 'Next race update',
          message: `${data.race.name || 'Next Grand Prix'} is the next race on the PADDOX calendar.`,
          category: 'Race Alerts',
          ref: `next-race-${data.race.season || ''}-${data.race.round || data.race.name || 'race'}`
        });
      }
    } catch {}

    successResponse(res, 200, 'Next race fetched', data);
  } catch (err) { next(err); }
};

/* ── GET FULL 2026 RACE CALENDAR ── */
exports.getSchedule = async (req, res, next) => {
  try {
    const year = req.query.year || getCurrentYear();
    const data = await withCache(`schedule_${year}`, async () => {
      const r     = await getSchedule(year);
      const races = r.data?.MRData?.RaceTable?.Races || [];
      const now   = new Date();

      return races.map(race => {
        const raceDate = new Date(`${race.date}T${race.time || '13:00:00Z'}`);
        const diff     = raceDate - now;
        const isPast   = raceDate < now;
        const isNext   = !isPast && diff === Math.min(...races
          .filter(r2 => new Date(`${r2.date}T${r2.time || '13:00:00Z'}`) > now)
          .map(r2 => new Date(`${r2.date}T${r2.time || '13:00:00Z'}`) - now));

        return {
          round      : parseInt(race.round),
          name       : race.raceName,
          season     : race.season,
          date       : race.date,
          time       : race.time,
          circuit    : race.Circuit?.circuitName,
          location   : race.Circuit?.Location?.locality,
          country    : race.Circuit?.Location?.country,
          flag       : getFlagEmoji(race.Circuit?.Location?.country),
          status     : isPast ? 'completed' : isNext ? 'next' : 'upcoming',
          sessions   : {
            fp1       : race.FirstPractice,
            fp2       : race.SecondPractice,
            fp3       : race.ThirdPractice,
            qualifying: race.Qualifying,
            sprint    : race.Sprint,
          }
        };
      });
    }, CACHE_TTL.schedule);

    successResponse(res, 200, 'Race schedule fetched', { year, races: data, total: data.length });
  } catch (err) { next(err); }
};

/* ── GET DRIVER STANDINGS ── */
exports.getDriverStandings = async (req, res, next) => {
  try {
    const year = req.query.year || getCurrentYear();
    const data = await withCache(`driver_standings_${year}`, async () => {
      const r        = await getDriverStandings(year);
      const standings= r.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

      return standings.map(s => ({
        position   : parseInt(s.position),
        points     : parseFloat(s.points),
        wins       : parseInt(s.wins),
        driver     : {
          id         : s.Driver?.driverId,
          code       : s.Driver?.code,
          number     : s.Driver?.permanentNumber,
          firstName  : s.Driver?.givenName,
          lastName   : s.Driver?.familyName,
          fullName   : `${s.Driver?.givenName} ${s.Driver?.familyName}`,
          nationality: s.Driver?.nationality,
          flag       : getFlagEmoji(s.Driver?.nationality),
          dob        : s.Driver?.dateOfBirth,
          url        : s.Driver?.url,
        },
        team       : {
          id   : s.Constructors?.[0]?.constructorId,
          name : s.Constructors?.[0]?.name,
          color: getTeamColor(s.Constructors?.[0]?.constructorId),
          emoji: getTeamEmoji(s.Constructors?.[0]?.constructorId),
        }
      }));
    }, CACHE_TTL.standings);

    successResponse(res, 200, 'Driver standings fetched', { year, standings: data });
  } catch (err) { next(err); }
};

/* ── GET CONSTRUCTOR STANDINGS ── */
exports.getConstructorStandings = async (req, res, next) => {
  try {
    const year = req.query.year || getCurrentYear();
    const data = await withCache(`cons_standings_${year}`, async () => {
      const r        = await getConsStandings(year);
      const standings= r.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];

      return standings.map(s => ({
        position   : parseInt(s.position),
        points     : parseFloat(s.points),
        wins       : parseInt(s.wins),
        team       : {
          id          : s.Constructor?.constructorId,
          name        : s.Constructor?.name,
          nationality : s.Constructor?.nationality,
          color       : getTeamColor(s.Constructor?.constructorId),
          emoji       : getTeamEmoji(s.Constructor?.constructorId),
        }
      }));
    }, CACHE_TTL.standings);

    successResponse(res, 200, 'Constructor standings fetched', { year, standings: data });
  } catch (err) { next(err); }
};

/* ── GET RACE RESULTS ── */
exports.getRaceResults = async (req, res, next) => {
  try {
    const { round }= req.params;
    const year     = req.query.year || getCurrentYear();
    const data     = await withCache(`results_${year}_${round}`, async () => {
      const r    = await getRaceResults(year, round);
      const race = r.data?.MRData?.RaceTable?.Races?.[0];
      if (!race) return null;

      return {
        round  : race.round,
        name   : race.raceName,
        date   : race.date,
        circuit: race.Circuit?.circuitName,
        country: race.Circuit?.Location?.country,
        flag   : getFlagEmoji(race.Circuit?.Location?.country),
        results: race.Results?.map(r2 => ({
          position   : parseInt(r2.position),
          number     : r2.number,
          points     : parseFloat(r2.points),
          status     : r2.status,
          grid       : parseInt(r2.grid),
          laps       : parseInt(r2.laps),
          time       : r2.Time?.time,
          fastestLap : r2.FastestLap?.Time?.time,
          driver     : {
            code     : r2.Driver?.code,
            firstName: r2.Driver?.givenName,
            lastName : r2.Driver?.familyName,
            flag     : getFlagEmoji(r2.Driver?.nationality),
          },
          team       : {
            name : r2.Constructor?.name,
            color: getTeamColor(r2.Constructor?.constructorId),
            emoji: getTeamEmoji(r2.Constructor?.constructorId),
          }
        })) || []
      };
    }, CACHE_TTL.results);

    if (!data) return errorResponse(res, 404, 'Race results not found');
    successResponse(res, 200, 'Race results fetched', { race: data });
  } catch (err) { next(err); }
};

/* ── GET LAST RACE RESULT ── */
exports.getLastResult = async (req, res, next) => {
  try {
    const data = await withCache('last_result', async () => {
      const r    = await getLastResult();
      const race = r.data?.MRData?.RaceTable?.Races?.[0];
      if (!race) return null;
      return {
        round  : race.round,
        name   : race.raceName,
        date   : race.date,
        winner : {
          name : `${race.Results?.[0]?.Driver?.givenName} ${race.Results?.[0]?.Driver?.familyName}`,
          code : race.Results?.[0]?.Driver?.code,
          team : race.Results?.[0]?.Constructor?.name,
          time : race.Results?.[0]?.Time?.time,
          flag : getFlagEmoji(race.Results?.[0]?.Driver?.nationality),
          emoji: getTeamEmoji(race.Results?.[0]?.Constructor?.constructorId),
        },
        top3   : race.Results?.slice(0, 3).map(r2 => ({
          position : parseInt(r2.position),
          name     : `${r2.Driver?.givenName} ${r2.Driver?.familyName}`,
          code     : r2.Driver?.code,
          team     : r2.Constructor?.name,
          points   : r2.points,
          flag     : getFlagEmoji(r2.Driver?.nationality),
        })) || []
      };
    }, CACHE_TTL.results);

    successResponse(res, 200, 'Last result fetched', { race: data });
  } catch (err) { next(err); }
};

/* ── GET ALL DRIVERS (current season) ── */
exports.getAllDrivers = async (req, res, next) => {
  try {
    const year = req.query.year || getCurrentYear();
    const data = await withCache(`all_drivers_${year}`, async () => {
      const r       = await getDrivers(year);
      const drivers = r.data?.MRData?.DriverTable?.Drivers || [];
      return drivers.map(d => ({
        id         : d.driverId,
        code       : d.code,
        number     : d.permanentNumber,
        firstName  : d.givenName,
        lastName   : d.familyName,
        fullName   : `${d.givenName} ${d.familyName}`,
        nationality: d.nationality,
        flag       : getFlagEmoji(d.nationality),
        dob        : d.dateOfBirth,
        url        : d.url,
      }));
    }, CACHE_TTL.schedule);

    successResponse(res, 200, 'Drivers fetched', { year, drivers: data, total: data.length });
  } catch (err) { next(err); }
};

/* ── GET LIVE SESSION DATA (OpenF1) ── */
exports.getLiveSession = async (req, res, next) => {
  try {
    const data = await withCache('live_session', async () => {
      const [sessions, drivers] = await Promise.all([
        getOpenF1Sessions({ year: getCurrentYear() }),
        getOpenF1Drivers({ session_key: 'latest' }),
      ]);

      const latestSession = sessions.data?.[sessions.data.length - 1];
      return {
        session  : latestSession || null,
        drivers  : drivers.data?.slice(0, 20) || [],
        fetchedAt: new Date().toISOString(),
        year     : getCurrentYear(),
      };
    }, CACHE_TTL.live);

    try { getIO().to('race:live').emit('race:session-update', data); } catch {}
    successResponse(res, 200, 'Live session fetched', data);
  } catch (err) { next(err); }
};

/* ── GET SESSIONS LIST ── */
exports.getSessions = async (req, res, next) => {
  try {
    const year = req.query.year || getCurrentYear();
    const data = await withCache(`sessions_${year}`, async () => {
      const r = await getOpenF1Sessions({ year });
      return r.data || [];
    }, CACHE_TTL.schedule);
    successResponse(res, 200, 'Sessions fetched', { sessions: data });
  } catch (err) { next(err); }
};

/* ── CLEAR CACHE (admin use) ── */
exports.clearCache = async (req, res, next) => {
  try {
    cache.clear();
    successResponse(res, 200, 'F1 data cache cleared — fresh data on next request');
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════
   HELPER FUNCTIONS
══════════════════════════════════════ */

/* Country/nationality → Flag emoji */
function getFlagEmoji(countryOrNationality) {
  const flags = {
    /* Countries */
    'Bahrain': '🇧🇭', 'Saudi Arabia': '🇸🇦', 'Australia': '🇦🇺',
    'Japan': '🇯🇵', 'China': '🇨🇳', 'United States': '🇺🇸',
    'USA': '🇺🇸', 'Italy': '🇮🇹', 'Monaco': '🇲🇨',
    'Canada': '🇨🇦', 'Spain': '🇪🇸', 'Austria': '🇦🇹',
    'United Kingdom': '🇬🇧', 'Hungary': '🇭🇺', 'Belgium': '🇧🇪',
    'Netherlands': '🇳🇱', 'Singapore': '🇸🇬', 'Azerbaijan': '🇦🇿',
    'Mexico': '🇲🇽', 'Brazil': '🇧🇷', 'UAE': '🇦🇪',
    'Abu Dhabi': '🇦🇪', 'Qatar': '🇶🇦', 'Las Vegas': '🇺🇸',
    'Miami': '🇺🇸', 'France': '🇫🇷', 'Germany': '🇩🇪',
    'Portugal': '🇵🇹', 'Turkey': '🇹🇷',
    /* Nationalities */
    'Dutch': '🇳🇱', 'British': '🇬🇧', 'Monegasque': '🇲🇨',
    'Spanish': '🇪🇸', 'Mexican': '🇲🇽', 'Finnish': '🇫🇮',
    'Australian': '🇦🇺', 'Canadian': '🇨🇦', 'French': '🇫🇷',
    'German': '🇩🇪', 'Thai': '🇹🇭', 'Chinese': '🇨🇳',
    'American': '🇺🇸', 'Danish': '🇩🇰', 'Japanese': '🇯🇵',
    'Italian': '🇮🇹', 'New Zealander': '🇳🇿', 'Argentine': '🇦🇷',
    'Brazilian': '🇧🇷', 'Belgian': '🇧🇪', 'Swiss': '🇨🇭',
  };
  return flags[countryOrNationality] || '🏁';
}

/* Team ID → Primary color */
function getTeamColor(teamId) {
  const colors = {
    'red_bull'   : '#3671C6', 'ferrari'    : '#E8002D',
    'mercedes'   : '#27F4D2', 'mclaren'    : '#FF8000',
    'aston_martin': '#358C75','alpine'     : '#FF87BC',
    'williams'   : '#64C4FF', 'rb'         : '#6692FF',
    'kick_sauber': '#52E252', 'haas'       : '#B6BABD',
  };
  return colors[teamId] || '#e8002d';
}

/* Team ID → Emoji */
function getTeamEmoji(teamId) {
  const emojis = {
    'red_bull'   : '🔵', 'ferrari'    : '🔴',
    'mercedes'   : '⚫', 'mclaren'    : '🟠',
    'aston_martin': '🟢','alpine'     : '🩷',
    'williams'   : '🔵', 'rb'         : '🔵',
    'kick_sauber': '🟢', 'haas'       : '⬜',
  };
  return emojis[teamId] || '🏎️';
}

/* ══════════════════════════════════════
   PIT WALL REAL SESSION DATA
   Practice 1/2/3, Qualifying, Sprint Qualifying, Sprint Race, Race
   Uses backend proxy to avoid browser CORS/connection issues.
══════════════════════════════════════ */

const OPENF1_BASE = 'https://api.openf1.org/v1';
const PIT_SESSION_ALIASES = {
  FP1: ['Practice 1'],
  FP2: ['Practice 2'],
  FP3: ['Practice 3'],
  Qualifying: ['Qualifying'],
  'Sprint Qualifying': ['Sprint Qualifying', 'Sprint Shootout'],
  Sprint: ['Sprint'],
  Race: ['Race']
};

function queryString(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.append(k, v);
  });
  return q.toString();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function openF1(endpoint, params = {}) {
  const headers = { Accept: 'application/json' };
  const token = process.env.OPENF1_API_KEY || process.env.OPENF1_TOKEN || '';
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await axios.get(`${OPENF1_BASE}/${endpoint}`, {
        params,
        timeout: 20000,
        headers,
        validateStatus: status => status >= 200 && status < 500
      });
      if (response.status >= 400) {
        const e = new Error(`OpenF1 ${endpoint} returned ${response.status}`);
        e.status = response.status;
        throw e;
      }
      return response.data;
    } catch (err) {
      lastErr = err;
      const status = err.response?.status || err.status;
      const retryable = !status || status >= 500 || ['ECONNRESET','ETIMEDOUT','ECONNABORTED'].includes(err.code);
      if (!retryable || attempt === 2) break;
      await wait(700 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function openF1LatestSessionForYear(year) {
  const sessions = await openF1('sessions', { year }).catch(() => []);
  const now = Date.now();
  const usable = (sessions || [])
    .filter(s => s.session_key && s.date_start && new Date(s.date_start).getTime() <= now)
    .sort((a, b) => new Date(b.date_start || 0) - new Date(a.date_start || 0));
  return usable[0] || null;
}

function asDate(date, time = '13:00:00Z') {
  if (!date) return null;
  const t = String(time || '13:00:00Z');
  return new Date(`${date}T${t}`);
}

async function getScheduleRace(year, round) {
  const r = await getSchedule(year);
  const races = r.data?.MRData?.RaceTable?.Races || [];
  const race = races.find(x => Number(x.round) === Number(round)) || races[0];
  return { races, race };
}

async function findMeetingForRound(year, round) {
  const { race } = await getScheduleRace(year, round);
  const meetings = await openF1('meetings', { year }).catch(() => []);
  if (!race) {
    const latestSession = await openF1LatestSessionForYear(year).catch(() => null);
    const meeting = latestSession
      ? (meetings || []).find(m => Number(m.meeting_key) === Number(latestSession.meeting_key))
      : null;
    return { meeting: meeting || null, race: null };
  }

  const raceDate = asDate(race.date, race.time || '13:00:00Z');
  const raceCountry = String(race.Circuit?.Location?.country || '').toLowerCase();
  const raceLocality = String(race.Circuit?.Location?.locality || '').toLowerCase();
  const raceName = String(race.raceName || '').toLowerCase();

  let meeting = (meetings || []).find(m => {
    if (!m.date_start || !raceDate) return false;
    const start = new Date(m.date_start);
    const diffDays = (raceDate - start) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  });

  if (!meeting) {
    meeting = (meetings || []).find(m => {
      const hay = `${m.meeting_name || ''} ${m.country_name || ''} ${m.location || ''} ${m.circuit_short_name || ''}`.toLowerCase();
      return (raceCountry && hay.includes(raceCountry)) || (raceLocality && hay.includes(raceLocality)) ||
             (raceName && raceName.split(' ').some(w => w.length > 4 && hay.includes(w)));
    });
  }

  return { meeting: meeting || null, race };
}

async function findSession(year, round, sessionKey) {
  const { meeting, race } = await findMeetingForRound(year, round);
  if (!meeting) return { openSession: null, race, meeting: null };

  const sessions = await openF1('sessions', { meeting_key: meeting.meeting_key }).catch(() => []);
  const aliases = PIT_SESSION_ALIASES[sessionKey] || [sessionKey];
  const openSession = (sessions || []).find(s =>
    aliases.some(a => String(s.session_name || '').toLowerCase() === String(a).toLowerCase())
  );
  return { openSession: openSession || null, race, meeting, allOpenSessions: sessions || [] };
}

function pitSessionFromRace(race) {
  const sessions = [];
  const push = (key, label, obj) => {
    if (!obj) return;
    const date = obj.date ? `${obj.date}T${obj.time || '13:00:00Z'}` : '';
    sessions.push({ key, label, date, available: true });
  };
  push('FP1', 'Practice 1', race.FirstPractice);
  push('FP2', 'Practice 2', race.SecondPractice);
  push('FP3', 'Practice 3', race.ThirdPractice);
  push('Sprint Qualifying', 'Sprint Qualifying', race.SprintQualifying || race.SprintShootout);
  push('Sprint', 'Sprint Race', race.Sprint);
  push('Qualifying', 'Qualifying', race.Qualifying);
  push('Race', 'Race', { date: race.date, time: race.time });
  return sessions;
}

function openSessionToPitKey(name = '') {
  const n = String(name || '').toLowerCase();
  if (n.includes('practice 1')) return 'FP1';
  if (n.includes('practice 2')) return 'FP2';
  if (n.includes('practice 3')) return 'FP3';
  if (n.includes('sprint') && (n.includes('qualifying') || n.includes('shootout'))) return 'Sprint Qualifying';
  if (n === 'sprint' || n.includes('sprint race')) return 'Sprint';
  if (n.includes('qualifying')) return 'Qualifying';
  if (n.includes('race')) return 'Race';
  return name;
}

async function sessionHasTimingData(sessionKey) {
  if (!sessionKey) return false;
  const [laps, stints, intervals] = await Promise.all([
    openF1('laps', { session_key: sessionKey }).catch(() => []),
    openF1('stints', { session_key: sessionKey }).catch(() => []),
    openF1('intervals', { session_key: sessionKey }).catch(() => [])
  ]);
  return Boolean((laps && laps.length) || (stints && stints.length) || (intervals && intervals.length));
}

function tyreCode(raw = '') {
  const map = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
  return map[String(raw || '').toUpperCase()] || String(raw || '').slice(0, 1).toUpperCase() || '';
}

function secToLap(s) {
  const n = Number(s || 0);
  if (!n) return '—';
  const m = Math.floor(n / 60);
  const r = (n % 60).toFixed(3).padStart(6, '0');
  return m > 0 ? `${m}:${r}` : r;
}

function latestByDriver(list, key = 'driver_number') {
  const map = new Map();
  for (const item of list || []) {
    const id = item[key];
    if (!id) continue;
    const old = map.get(id);
    const itemDate = new Date(item.date || item.date_start || item.timestamp || 0).getTime();
    const oldDate = old ? new Date(old.date || old.date_start || old.timestamp || 0).getTime() : -1;
    if (!old || itemDate >= oldDate) map.set(id, item);
  }
  return map;
}

function normalizeCode(name = '') {
  return String(name || '').split(' ').filter(Boolean).map(x => x[0]).join('').slice(0, 3).toUpperCase();
}

async function getProfileImageMap() {
  const map = new Map();
  if (!FanDriverProfile) return map;
  try {
    const profiles = await FanDriverProfile.find({ isActive: true }).lean();
    for (const p of profiles || []) {
      if (!p.image) continue;
      const keys = [p.code, p.name, p.driverKey].filter(Boolean);
      for (const k of keys) map.set(String(k).trim().toLowerCase(), p.image);
    }
  } catch (_) {}
  return map;
}

function imageForDriver(d, profileMap) {
  const full = d.full_name || d.broadcast_name || '';
  const code = d.name_acronym || normalizeCode(full);
  return profileMap.get(String(code).toLowerCase()) ||
         profileMap.get(String(full).toLowerCase()) ||
         d.headshot_url || '';
}

function flagFromCountryCode(code = '') {
  const c = String(code || '').trim().toUpperCase();
  if (c.length !== 2) return '';
  return c.replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

exports.getPitWallWeekend = async (req, res, next) => {
  try {
    const year = Number(req.query.year || getCurrentYear());
    const requestedRound = req.query.round ? Number(req.query.round) : null;

    const data = await withCache(`pit_weekend_v2_${year}_${requestedRound || 'auto'}`, async () => {
      const schedule = await getSchedule(year).catch(() => null);
      const races = schedule?.data?.MRData?.RaceTable?.Races || [];
      const meetings = await openF1('meetings', { year }).catch(() => []);
      const allSessions = await openF1('sessions', { year }).catch(() => []);
      const now = Date.now();

      let race = null;
      if (requestedRound) {
        race = races.find(x => Number(x.round) === Number(requestedRound)) || null;
      } else {
        const pastRaces = races
          .filter(r => new Date(`${r.date}T${r.time || '23:59:00Z'}`).getTime() <= now)
          .sort((a, b) => Number(b.round) - Number(a.round));
        race = pastRaces[0] || races[0] || null;
      }

      let meeting = null;
      if (race) {
        const raceDate = asDate(race.date, race.time || '13:00:00Z');
        const raceCountry = String(race.Circuit?.Location?.country || '').toLowerCase();
        const raceLocality = String(race.Circuit?.Location?.locality || '').toLowerCase();
        meeting = (meetings || []).find(m => {
          const start = new Date(m.date_start || 0);
          const diffDays = raceDate ? (raceDate - start) / 86400000 : 999;
          const hay = `${m.meeting_name || ''} ${m.country_name || ''} ${m.location || ''} ${m.circuit_short_name || ''}`.toLowerCase();
          return (diffDays >= 0 && diffDays <= 7) ||
                 (raceCountry && hay.includes(raceCountry)) ||
                 (raceLocality && hay.includes(raceLocality));
        }) || null;
      }

      if (!meeting) {
        const latest = (allSessions || [])
          .filter(s => s.session_key && s.date_start && new Date(s.date_start).getTime() <= now)
          .sort((a, b) => new Date(b.date_start || 0) - new Date(a.date_start || 0))[0];
        meeting = latest ? (meetings || []).find(m => Number(m.meeting_key) === Number(latest.meeting_key)) : null;
      }

      const openSessions = meeting
        ? (allSessions || []).filter(s => Number(s.meeting_key) === Number(meeting.meeting_key))
        : [];

      let sessions = race ? pitSessionFromRace(race) : [];
      const knownKeys = new Set(sessions.map(s => s.key));
      for (const os of openSessions) {
        const key = openSessionToPitKey(os.session_name);
        if (!knownKeys.has(key)) {
          sessions.push({ key, label: key === 'Sprint' ? 'Sprint Race' : sessionLabelForBackend(key), date: os.date_start, available: true });
          knownKeys.add(key);
        }
      }

      const sessionByKey = new Map();
      for (const os of openSessions) sessionByKey.set(openSessionToPitKey(os.session_name), os);

      const timingChecks = await Promise.all(sessions.map(async s => {
        const os = sessionByKey.get(s.key);
        const hasTiming = os ? await sessionHasTimingData(os.session_key) : false;
        const dt = s.date || os?.date_start || '';
        const status = hasTiming ? 'DATA' : (dt && new Date(dt).getTime() > now ? 'TBA' : 'NO DATA');
        return { ...s, date: dt, available: Boolean(os), openF1: Boolean(os), session_key: os?.session_key || null, status, hasTiming };
      }));

      sessions = timingChecks;

      const latestWithTiming = [...sessions]
        .filter(s => s.hasTiming)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
      const latestPast = [...sessions]
        .filter(s => s.date && new Date(s.date).getTime() <= now)
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
      const defaultSession = latestWithTiming?.key || latestPast?.key || sessions[0]?.key || '';

      const round = race ? Number(race.round) : requestedRound || null;
      return {
        race: race ? {
          round: Number(race.round), name: race.raceName, date: race.date, time: race.time,
          circuit: race.Circuit?.circuitName,
          location: race.Circuit?.Location?.locality,
          country: race.Circuit?.Location?.country,
          flag: getFlagEmoji(race.Circuit?.Location?.country)
        } : {
          round,
          name: meeting?.meeting_name || '',
          circuit: meeting?.circuit_short_name || '',
          location: meeting?.location || '',
          country: meeting?.country_name || '',
          flag: getFlagEmoji(meeting?.country_name)
        },
        meeting: meeting ? {
          meeting_key: meeting.meeting_key,
          name: meeting.meeting_name,
          location: meeting.location,
          country: meeting.country_name
        } : null,
        sessions,
        defaultSession,
        dataNote: process.env.OPENF1_API_KEY || process.env.OPENF1_TOKEN
          ? 'Live session data enabled when available.'
          : 'Session timing will appear when available.'
      };
    }, CACHE_TTL.live);
    successResponse(res, 200, 'Pit Wall weekend fetched', data);
  } catch (err) { next(err); }
};

function sessionLabelForBackend(k) {
  return {FP1:'Practice 1',FP2:'Practice 2',FP3:'Practice 3','Sprint Qualifying':'Sprint Qualifying',Sprint:'Sprint Race',Qualifying:'Qualifying',Race:'Race'}[k] || k;
}


exports.getPitWallSession = async (req, res, next) => {
  try {
    const year = Number(req.query.year || getCurrentYear());
    const round = Number(req.query.round || 1);
    const sessionKey = req.query.session || 'Race';

    const data = await withCache(`pit_session_v2_${year}_${round}_${sessionKey}`, async () => {
      const { openSession, race, meeting } = await findSession(year, round, sessionKey);
      if (!openSession) {
        return {
          year, round, session: sessionKey, race, source: 'Session not available yet',
          live: false, rows: [], weather: null, raceControl: [], fetchedAt: new Date().toISOString()
        };
      }

      const session_key = openSession.session_key;
      const [drivers, laps, stints, positions, intervals, weather, raceControl] = await Promise.all([
        openF1('drivers', { session_key }).catch(() => []),
        openF1('laps', { session_key }).catch(() => []),
        openF1('stints', { session_key }).catch(() => []),
        openF1('position', { session_key }).catch(() => []),
        openF1('intervals', { session_key }).catch(() => []),
        openF1('weather', { session_key }).catch(() => []),
        openF1('race_control', { session_key }).catch(() => []),
      ]);

      const hasRealTiming = Boolean((laps || []).length || (stints || []).length || (intervals || []).length);
      if (!hasRealTiming) {
        const w = (weather || [])[weather.length - 1] || null;
        return {
          year, round, session: sessionKey,
          openF1: { meeting_key: meeting?.meeting_key, session_key, session_name: openSession.session_name },
          race: race ? { name: race.raceName, round: race.round, circuit: race.Circuit?.circuitName, country: race.Circuit?.Location?.country } : null,
          source: process.env.OPENF1_API_KEY || process.env.OPENF1_TOKEN
            ? 'Session data service'
            : 'Session data service',
          dataQuality: 'NO_TIMING_DATA',
          live: false,
          rows: [],
          driverMetaCount: (drivers || []).length,
          weather: w ? {
            airTemp: w.air_temperature,
            trackTemp: w.track_temperature,
            humidity: w.humidity,
            rainfall: w.rainfall,
            windSpeed: w.wind_speed,
            summary: `Air ${Math.round(w.air_temperature || 0)}°C · Track ${Math.round(w.track_temperature || 0)}°C · Humidity ${Math.round(w.humidity || 0)}%`
          } : null,
          raceControl: (raceControl || []).slice(-12),
          message: 'Timing data is not available for this session yet.',
          fetchedAt: new Date().toISOString()
        };
      }

      const profileMap = await getProfileImageMap();
      const posMap = latestByDriver(positions);
      const intMap = latestByDriver(intervals);
      const lastLapMap = new Map();
      const bestLapMap = new Map();
      const lapCountMap = new Map();
      for (const lap of laps || []) {
        const num = lap.driver_number;
        if (!num) continue;
        if (lap.lap_duration && !lap.is_pit_out_lap) {
          lapCountMap.set(num, (lapCountMap.get(num) || 0) + 1);
          const best = bestLapMap.get(num);
          if (!best || Number(lap.lap_duration) < Number(best.lap_duration || 99999)) bestLapMap.set(num, lap);
        }
        const last = lastLapMap.get(num);
        if (!last || Number(lap.lap_number || 0) >= Number(last.lap_number || 0)) lastLapMap.set(num, lap);
      }

      const stintMap = new Map();
      for (const st of stints || []) {
        const num = st.driver_number;
        if (!num) continue;
        if (!stintMap.has(num)) stintMap.set(num, []);
        stintMap.get(num).push(st);
      }

      function currentStint(num) {
        const list = (stintMap.get(num) || []).sort((a, b) => Number(a.lap_start || 0) - Number(b.lap_start || 0));
        const lastLap = lastLapMap.get(num);
        const lapNo = Number(lastLap?.lap_number || 0);
        let st = list.find(x => lapNo >= Number(x.lap_start || 0) && lapNo <= Number(x.lap_end || 9999)) || list[list.length - 1];
        if (!st) return { tyre: '', age: null, stint: null };
        const age = lapNo ? Math.max(0, lapNo - Number(st.lap_start || 1) + 1 + Number(st.tyre_age_at_start || 0)) : null;
        return { tyre: tyreCode(st.compound), age, stint: st.stint_number || null };
      }

      const rows = (drivers || []).map((d, index) => {
        const num = d.driver_number;
        const best = bestLapMap.get(num);
        const last = lastLapMap.get(num);
        const pos = posMap.get(num);
        const intr = intMap.get(num);
        const st = currentStint(num);
        const fullName = d.full_name || d.broadcast_name || `${d.first_name || ''} ${d.last_name || ''}`.trim();
        return {
          driverNumber: num,
          position: Number(pos?.position || index + 1),
          code: d.name_acronym || normalizeCode(fullName),
          name: fullName,
          firstName: d.first_name || '',
          lastName: d.last_name || '',
          team: d.team_name || '',
          teamColor: d.team_colour ? `#${String(d.team_colour).replace('#','')}` : getTeamColor(String(d.team_name || '').toLowerCase().replaceAll(' ', '_')),
          flag: flagFromCountryCode(d.country_code),
          image: imageForDriver(d, profileMap),
          gap: intr?.gap_to_leader || intr?.interval || (Number(pos?.position) === 1 ? 'LEADER' : '—'),
          bestSec: best?.lap_duration || null,
          bestLap: best?.lap_duration ? secToLap(best.lap_duration) : '—',
          lastSec: last?.lap_duration || null,
          lastLap: last?.lap_duration ? secToLap(last.lap_duration) : '—',
          s1: best?.duration_sector_1 ? Number(best.duration_sector_1).toFixed(3) : '—',
          s2: best?.duration_sector_2 ? Number(best.duration_sector_2).toFixed(3) : '—',
          s3: best?.duration_sector_3 ? Number(best.duration_sector_3).toFixed(3) : '—',
          laps: lapCountMap.get(num) || 0,
          tyre: st.tyre,
          tyreAge: st.age,
          stint: st.stint,
        };
      }).sort((a, b) => Number(a.position || 999) - Number(b.position || 999));

      const w = (weather || [])[weather.length - 1] || null;
      return {
        year, round, session: sessionKey,
        openF1: { meeting_key: meeting?.meeting_key, session_key, session_name: openSession.session_name },
        race: race ? { name: race.raceName, round: race.round, circuit: race.Circuit?.circuitName, country: race.Circuit?.Location?.country } : null,
        source: process.env.OPENF1_API_KEY || process.env.OPENF1_TOKEN ? 'Session data service' : 'Session data service',
        dataQuality: 'REAL_TIMING_DATA',
        live: true,
        rows,
        weather: w ? {
          airTemp: w.air_temperature,
          trackTemp: w.track_temperature,
          humidity: w.humidity,
          rainfall: w.rainfall,
          windSpeed: w.wind_speed,
          summary: `Air ${Math.round(w.air_temperature || 0)}°C · Track ${Math.round(w.track_temperature || 0)}°C · Humidity ${Math.round(w.humidity || 0)}%`
        } : null,
        raceControl: (raceControl || []).slice(-12),
        fetchedAt: new Date().toISOString()
      };
    }, CACHE_TTL.live);

    try { getIO().to('race:live').emit('race:session-update', data); } catch {}
    successResponse(res, 200, 'Pit Wall session fetched', data);
  } catch (err) { next(err); }
};
