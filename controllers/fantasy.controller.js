const {
  getCurrentYear,
  getNextRace,
  getDriverStandings,
  getRaceResults,
  getQualifying
} = require('../utils/f1Api');
const { predictFantasy } = require('../services/aiClient.service');

const CACHE_TTL_MS = 90 * 1000;
let cache = { ts: 0, data: null };

function jolpicaRace(response) {
  return response?.data?.MRData?.RaceTable?.Races?.[0] || null;
}

function standingsList(response) {
  return response?.data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
}

function qualifyingMap(response) {
  const race = jolpicaRace(response);
  const rows = race?.QualifyingResults || [];
  const map = new Map();
  rows.forEach(row => {
    const id = row?.Driver?.driverId;
    const position = Number(row?.position);
    if (id && Number.isFinite(position)) map.set(id, position);
  });
  return { race, map };
}

function resultMap(response) {
  const race = jolpicaRace(response);
  const rows = race?.Results || [];
  const map = new Map();
  rows.forEach(row => {
    const id = row?.Driver?.driverId;
    const position = Number(row?.position);
    if (id && Number.isFinite(position)) map.set(id, position);
  });
  return { race, map };
}

async function latestAvailableQualifying(year, targetRound) {
  for (let round = targetRound; round >= Math.max(1, targetRound - 4); round -= 1) {
    try {
      const response = await getQualifying(year, round);
      const parsed = qualifyingMap(response);
      if (parsed.map.size) {
        return {
          round,
          race: parsed.race,
          map: parsed.map,
          isTargetRound: round === targetRound
        };
      }
    } catch (_) {}
  }
  return { round: null, race: null, map: new Map(), isTargetRound: false };
}

async function recentResultMaps(year, targetRound, count = 5) {
  const rounds = [];
  for (let round = targetRound - 1; round >= 1 && rounds.length < count; round -= 1) {
    rounds.push(round);
  }

  const settled = await Promise.allSettled(rounds.map(round => getRaceResults(year, round)));
  return settled
    .map((result, index) => {
      if (result.status !== 'fulfilled') return null;
      const parsed = resultMap(result.value);
      return parsed.map.size ? { round: rounds[index], ...parsed } : null;
    })
    .filter(Boolean);
}

function rollingAverageFinish(driverId, resultMaps) {
  const finishes = resultMaps
    .map(entry => entry.map.get(driverId))
    .filter(value => Number.isFinite(value));
  if (!finishes.length) return 20;
  return finishes.reduce((sum, value) => sum + value, 0) / finishes.length;
}

function driverLabel(standing) {
  const driver = standing?.Driver || {};
  return `${driver.givenName || ''} ${driver.familyName || ''}`.trim() || driver.code || driver.driverId || 'Driver';
}

function buildInputQuality(qualifying) {
  if (qualifying.isTargetRound) {
    return {
      mode: 'target_qualifying',
      label: 'RACE READY',
      confidence: 'high',
      note: 'The target race qualifying order is available and is used directly by the model.'
    };
  }
  if (qualifying.map.size) {
    return {
      mode: 'latest_real_qualifying',
      label: 'PROVISIONAL',
      confidence: 'medium',
      note: 'Target-race qualifying is not available yet. The latest completed real qualifying session is used as a provisional input.'
    };
  }
  return {
    mode: 'championship_position_proxy',
    label: 'EARLY PROVISIONAL',
    confidence: 'low',
    note: 'No recent qualifying result was available, so current championship position is used as an explicit fallback proxy.'
  };
}

async function buildPrediction() {
  const year = getCurrentYear();
  const [nextRaceResponse, standingsResponse] = await Promise.all([
    getNextRace(),
    getDriverStandings(year)
  ]);

  const nextRace = jolpicaRace(nextRaceResponse);
  if (!nextRace) {
    const error = new Error('No upcoming race is available from the F1 data source.');
    error.statusCode = 404;
    throw error;
  }

  const targetRound = Number(nextRace.round);
  const standings = standingsList(standingsResponse);
  if (!standings.length) {
    const error = new Error('Current driver standings are unavailable.');
    error.statusCode = 503;
    throw error;
  }

  const [qualifying, resultMaps] = await Promise.all([
    latestAvailableQualifying(year, targetRound),
    recentResultMaps(year, targetRound, 5)
  ]);
  const quality = buildInputQuality(qualifying);

  const featureRows = standings.map(standing => {
    const driver = standing.Driver || {};
    const constructor = standing.Constructors?.[0] || {};
    const driverId = driver.driverId;
    const realQualifyingPosition = qualifying.map.get(driverId);
    const qualifyingPosition = Number.isFinite(realQualifyingPosition)
      ? realQualifyingPosition
      : Number(standing.position || 20);
    const avgFinish = rollingAverageFinish(driverId, resultMaps);

    return {
      driver_id: driverId,
      qualifying_position: qualifyingPosition,
      constructor_id: constructor.constructorId || 'Unknown',
      features: {
        rolling_avg_finish: Number(avgFinish.toFixed(3))
      }
    };
  });

  const ai = await predictFantasy({ drivers: featureRows });
  const predictionMap = new Map((ai?.predictions || []).map(row => [String(row.driver_id), row]));

  const predictions = standings
    .map(standing => {
      const driver = standing.Driver || {};
      const constructor = standing.Constructors?.[0] || {};
      const input = featureRows.find(row => row.driver_id === driver.driverId);
      const prediction = predictionMap.get(String(driver.driverId));
      if (!prediction || !input) return null;

      return {
        driverId: driver.driverId,
        code: driver.code || '',
        fullName: driverLabel(standing),
        number: driver.permanentNumber || '',
        teamId: constructor.constructorId || '',
        team: constructor.name || constructor.constructorId || 'Unknown',
        championshipPosition: Number(standing.position || 0),
        championshipPoints: Number(standing.points || 0),
        qualifyingPosition: Number(input.qualifying_position),
        rollingAvgFinish: Number(input.features.rolling_avg_finish),
        predictedFantasyPoints: Number(prediction.predicted_fantasy_points || 0),
        predictedRank: prediction.predicted_rank == null ? null : Number(prediction.predicted_rank),
        inputSignal: `Q${Number(input.qualifying_position)} · ${Number(input.features.rolling_avg_finish).toFixed(1)} avg finish · ${constructor.name || constructor.constructorId || 'team'}`
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.predictedRank != null && b.predictedRank != null) return a.predictedRank - b.predictedRank;
      return b.predictedFantasyPoints - a.predictedFantasyPoints;
    });

  return {
    race: {
      season: Number(nextRace.season || year),
      round: targetRound,
      name: nextRace.raceName || 'Next Grand Prix',
      date: nextRace.date || '',
      time: nextRace.time || '',
      circuit: nextRace.Circuit?.circuitName || '',
      locality: nextRace.Circuit?.Location?.locality || '',
      country: nextRace.Circuit?.Location?.country || ''
    },
    model: {
      algorithm: 'Random Forest Regressor',
      modelVersion: ai?.model_version || 'unknown',
      scoringVersion: ai?.scoring_version || 'PADDOX_FANTASY_V1',
      inferenceLatencyMs: Number(ai?.inference_latency_ms || 0),
      fieldSize: Number(ai?.field_size || predictions.length)
    },
    inputQuality: quality,
    qualifyingSource: {
      round: qualifying.round,
      raceName: qualifying.race?.raceName || '',
      targetRaceQualifying: qualifying.isTargetRound
    },
    recentRaceRounds: resultMaps.map(entry => entry.round),
    lineup: predictions.slice(0, 5),
    predictions,
    generatedAt: new Date().toISOString(),
    sources: ['Jolpica/Ergast season + qualifying + race results', 'PADDOX trained Random Forest artifact']
  };
}

exports.getNextRacePrediction = async (req, res, next) => {
  try {
    const force = String(req.query.refresh || '') === '1';
    if (!force && cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
      return res.json({ success: true, data: { ...cache.data, cached: true } });
    }

    const data = await buildPrediction();
    cache = { ts: Date.now(), data };
    return res.json({ success: true, data: { ...data, cached: false } });
  } catch (err) {
    const status = Number(err.statusCode || err.response?.status || 500);
    if (status === 503 || err.code === 'AI_SERVICE_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        message: 'Fantasy ML service is not ready yet.',
        detail: err.message
      });
    }
    if (status === 404) {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
};
