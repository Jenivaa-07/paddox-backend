const {
  getNextRace,
  getDriverStandings,
  getConsStandings,
  getLastResult,
  getOpenF1Sessions,
  getCurrentYear,
} = require('../utils/f1Api');

const compact = (value, maxLength = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);

const detectContextNeeds = (query) => {
  const text = compact(query, 600).toLowerCase();
  return {
    nextRace: /\b(next|upcoming)\b.*\b(race|grand prix|gp)\b|\bwhen\b.*\b(race|qualifying|practice|sprint)\b|\b(schedule|calendar)\b/.test(text),
    driverStandings: /\b(driver|drivers|championship)\b.*\b(standing|standings|leader|leaders|points)\b|\bwho leads\b/.test(text),
    constructorStandings: /\b(constructor|constructors|team|teams)\b.*\b(standing|standings|championship|leader|leaders|points)\b/.test(text),
    lastResult: /\b(who won|winner|podium|result|results)\b.*\b(last|latest|previous|race|grand prix|gp)\b|\b(last|latest|previous)\b.*\b(result|winner|podium|race|grand prix|gp)\b/.test(text),
    liveSession: /\b(live|right now|current session|track temperature|race control)\b/.test(text),
  };
};

const mapNextRace = (response) => {
  const race = response?.data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return {
    name: compact(race.raceName),
    round: Number(race.round) || null,
    season: Number(race.season) || getCurrentYear(),
    date: compact(race.date, 20),
    time: compact(race.time, 20),
    circuit: compact(race.Circuit?.circuitName),
    location: compact(race.Circuit?.Location?.locality),
    country: compact(race.Circuit?.Location?.country),
    sessions: {
      practice1: race.FirstPractice || null,
      practice2: race.SecondPractice || null,
      practice3: race.ThirdPractice || null,
      sprint: race.Sprint || null,
      qualifying: race.Qualifying || null,
    },
  };
};

const mapDriverStandings = (response) => (
  response?.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || []
).slice(0, 10).map((row) => ({
  position: Number(row.position),
  points: Number(row.points),
  wins: Number(row.wins),
  driver: compact(`${row.Driver?.givenName || ''} ${row.Driver?.familyName || ''}`),
  code: compact(row.Driver?.code, 8),
  team: compact(row.Constructors?.[0]?.name),
}));

const mapConstructorStandings = (response) => (
  response?.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || []
).slice(0, 10).map((row) => ({
  position: Number(row.position),
  points: Number(row.points),
  wins: Number(row.wins),
  team: compact(row.Constructor?.name),
}));

const mapLastResult = (response) => {
  const race = response?.data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;
  return {
    name: compact(race.raceName),
    round: Number(race.round) || null,
    date: compact(race.date, 20),
    top3: (race.Results || []).slice(0, 3).map((row) => ({
      position: Number(row.position),
      driver: compact(`${row.Driver?.givenName || ''} ${row.Driver?.familyName || ''}`),
      code: compact(row.Driver?.code, 8),
      team: compact(row.Constructor?.name),
    })),
  };
};

const mapLiveSession = (response) => {
  const sessions = Array.isArray(response?.data) ? response.data : [];
  const session = sessions[sessions.length - 1];
  if (!session) return null;
  return {
    name: compact(session.session_name),
    type: compact(session.session_type),
    meeting: compact(session.meeting_name),
    circuit: compact(session.circuit_short_name),
    country: compact(session.country_name),
    startsAt: compact(session.date_start, 40),
    endsAt: compact(session.date_end, 40),
    year: Number(session.year) || getCurrentYear(),
  };
};

const buildLiveContext = async (query) => {
  const needs = detectContextNeeds(query);
  const jobs = [];
  if (needs.nextRace) jobs.push(['nextRace', getNextRace(), mapNextRace]);
  if (needs.driverStandings) jobs.push(['driverStandings', getDriverStandings(), mapDriverStandings]);
  if (needs.constructorStandings) jobs.push(['constructorStandings', getConsStandings(), mapConstructorStandings]);
  if (needs.lastResult) jobs.push(['lastResult', getLastResult(), mapLastResult]);
  if (needs.liveSession) jobs.push(['liveSession', getOpenF1Sessions({ year: getCurrentYear() }), mapLiveSession]);
  if (!jobs.length) return null;

  const settled = await Promise.allSettled(jobs.map(([, promise]) => promise));
  const context = {
    provider: 'PADDOX live F1 data layer',
    dataAsOf: new Date().toISOString(),
  };
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const [key, , mapper] = jobs[index];
    const mapped = mapper(result.value);
    if (mapped && (!Array.isArray(mapped) || mapped.length)) context[key] = mapped;
  });

  return Object.keys(context).length > 2 ? context : null;
};

const buildUserContext = (user) => {
  if (!user) return null;
  return {
    signedIn: true,
    firstName: compact(user.firstName, 50),
    fanPoints: Math.max(0, Number(user.fanPoints) || 0),
    fanTier: compact(user.fanTier, 30),
    favouriteTeam: compact(user.preferences?.favouriteTeam, 80),
    favouriteDriver: compact(user.preferences?.favouriteDriver, 80),
  };
};

module.exports = {
  buildLiveContext,
  buildUserContext,
  detectContextNeeds,
};
