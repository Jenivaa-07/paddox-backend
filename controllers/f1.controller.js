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
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');

/* ── In-memory cache (reduces API calls) ── */
const cache = new Map();
const CACHE_TTL = {
  live     : 30  * 1000,   /* 30 seconds  — for live race data */
  standings: 15  * 60 * 1000, /* 15 minutes — standings update after race */
  schedule : 60  * 60 * 1000, /* 1 hour     — calendar rarely changes */
  results  : 60  * 60 * 1000, /* 1 hour     — past results never change */
  nextRace : 5   * 60 * 1000, /* 5 minutes  — countdown updates */
};

const withCache = async (key, fetcher, ttl = 5 * 60 * 1000) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;
  const data = await fetcher();
  cache.set(key, { data, ts: Date.now() });
  return data;
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