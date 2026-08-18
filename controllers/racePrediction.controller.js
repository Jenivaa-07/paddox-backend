const { getRaceResults, getCurrentYear } = require('../utils/f1Api');
const { predictRace, warmAIService } = require('../services/aiClient.service');

const MAX_DRIVERS = 10;
const RECENT_ROUNDS = 5;

function cleanRows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 22)
    .map((row, index) => ({
      code: String(row?.code || '').trim().toUpperCase().slice(0, 6),
      name: String(row?.name || row?.driver || row?.code || `Driver ${index + 1}`).trim().slice(0, 80),
      team: String(row?.team || '').trim().slice(0, 80),
      position: Number(row?.position || index + 1),
      bestSec: Number(row?.bestSec || 0),
      lastSec: Number(row?.lastSec || 0),
      laps: Number(row?.laps || 0),
    }))
    .filter(row => row.code && Number.isFinite(row.position) && row.position > 0);
}

function raceResults(response) {
  return response?.data?.MRData?.RaceTable?.Races?.[0]?.Results || [];
}

async function rollingFinishMap(year, round) {
  const rounds = [];
  for (let r = Number(round) - 1; r >= 1 && rounds.length < RECENT_ROUNDS; r -= 1) rounds.push(r);
  if (!rounds.length) return new Map();

  const settled = await Promise.allSettled(rounds.map(r => getRaceResults(year, r)));
  const values = new Map();
  settled.forEach(result => {
    if (result.status !== 'fulfilled') return;
    raceResults(result.value).forEach(row => {
      const code = String(row?.Driver?.code || '').trim().toUpperCase();
      const position = Number(row?.position);
      if (!code || !Number.isFinite(position)) return;
      if (!values.has(code)) values.set(code, []);
      values.get(code).push(position);
    });
  });

  const averages = new Map();
  values.forEach((positions, code) => {
    if (!positions.length) return;
    averages.set(code, positions.reduce((sum, value) => sum + value, 0) / positions.length);
  });
  return averages;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function lapValue(row) {
  const values = [row.bestSec, row.lastSec]
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 30 && value < 300);
  if (!values.length) return null;
  return Math.min(...values);
}

function buildPaceRanks(rows) {
  const timed = rows
    .map(row => ({ code: row.code, lap: lapValue(row) }))
    .filter(item => Number.isFinite(item.lap))
    .sort((a, b) => a.lap - b.lap);

  const rank = new Map();
  timed.forEach((item, index) => rank.set(item.code, index + 1));
  return rank;
}

function raceFormFallback(row, rollingAvg, fieldSize, paceRanks) {
  const current = clamp(row.position, 1, fieldSize);
  const rolling = clamp(rollingAvg || current, 1, fieldSize);
  const paceRank = paceRanks.get(row.code);
  const hasPace = Number.isFinite(paceRank);

  const expected = hasPace
    ? (0.42 * current) + (0.33 * rolling) + (0.25 * clamp(paceRank, 1, fieldSize))
    : (0.58 * current) + (0.42 * rolling);

  const expectedFinishPosition = clamp(Number(expected.toFixed(2)), 1, fieldSize);
  const top10Probability = clamp(
    1 / (1 + Math.exp((expectedFinishPosition - 10.5) / 2.15)),
    0.02,
    0.98
  );

  return {
    expected_finish_position: expectedFinishPosition,
    top10_probability: Number(top10Probability.toFixed(4)),
    is_top10: top10Probability >= 0.5,
    model_version: 'race-form-v1',
    inference_latency_ms: 0,
    request_id: '',
    data_as_of: new Date().toISOString(),
    pace_rank_used: hasPace ? paceRank : null,
  };
}

function predictionPayload(row, rollingAvg, fieldSize) {
  const recentLaps = [row.bestSec, row.lastSec]
    .filter(value => Number.isFinite(value) && value > 30 && value < 300);
  return {
    recentLaps,
    payload: {
      recent_laps: recentLaps,
      features: {
        grid_position: row.position,
        rolling_avg_finish: Number(rollingAvg.toFixed(3)),
        field_size: fieldSize,
      }
    }
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = { status: 'fulfilled', value: await worker(items[index], index) }; }
      catch (reason) { output[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

exports.predictPitWallSession = async (req, res, next) => {
  try {
    const year = Number(req.body?.year || getCurrentYear());
    const round = Number(req.body?.round || 1);
    const session = String(req.body?.session || 'Session').slice(0, 40);
    const rows = cleanRows(req.body?.rows);

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No real timing rows were supplied for prediction.' });
    }

    const selected = [...rows]
      .sort((a, b) => a.position - b.position)
      .slice(0, MAX_DRIVERS);

    const [rollingMap, warmup] = await Promise.all([
      rollingFinishMap(year, round),
      warmAIService().catch(() => ({ reachable: false }))
    ]);

    const fieldSize = Math.max(rows.length, 2);
    const paceRanks = buildPaceRanks(selected);

    /* Probe the primary model once before fan-out. When Render is healthy but the
       LSTM artifact is unavailable, /health can still return 200. This probe
       prevents ten repeated 503 calls and switches the whole request immediately
       to the transparent real-data race-form predictor. */
    const firstRow = selected[0];
    const firstRolling = rollingMap.get(firstRow.code) || firstRow.position;
    const firstInput = predictionPayload(firstRow, firstRolling, fieldSize);
    let primaryGate = { available: false, prediction: null, error: '' };
    try {
      primaryGate = {
        available: true,
        prediction: await predictRace(firstInput.payload),
        error: ''
      };
    } catch (error) {
      primaryGate = {
        available: false,
        prediction: null,
        error: error?.response?.data?.status || error?.code || error?.message || 'lstm_unavailable'
      };
    }

    const settled = await mapWithConcurrency(selected, 3, async (row, index) => {
      const rollingAvg = rollingMap.get(row.code) || row.position;
      const input = predictionPayload(row, rollingAvg, fieldSize);
      let prediction = null;
      let source = 'lstm';
      let primaryError = '';

      if (!primaryGate.available) {
        source = 'race_form_fallback';
        primaryError = primaryGate.error;
        prediction = raceFormFallback(row, rollingAvg, fieldSize, paceRanks);
      } else if (index === 0) {
        prediction = primaryGate.prediction;
      } else {
        try {
          prediction = await predictRace(input.payload);
        } catch (error) {
          source = 'race_form_fallback';
          primaryError = error?.response?.data?.status || error?.code || error?.message || 'lstm_unavailable';
          prediction = raceFormFallback(row, rollingAvg, fieldSize, paceRanks);
        }
      }

      return {
        code: row.code,
        name: row.name,
        team: row.team,
        currentPosition: row.position,
        lapsAvailable: row.laps,
        recentLapSamplesUsed: input.recentLaps.length,
        rollingAvgFinish: Number(rollingAvg.toFixed(2)),
        expectedFinishPosition: Number(prediction.expected_finish_position),
        top10Probability: Number(prediction.top10_probability),
        isTop10: Boolean(prediction.is_top10),
        modelVersion: prediction.model_version || 'unknown',
        inferenceLatencyMs: Number(prediction.inference_latency_ms || 0),
        requestId: prediction.request_id || '',
        dataAsOf: prediction.data_as_of || '',
        inferenceSource: source,
        primaryError,
        paceRankUsed: prediction.pace_rank_used ?? paceRanks.get(row.code) ?? null,
      };
    });

    const predictions = settled
      .filter(result => result?.status === 'fulfilled')
      .map(result => result.value)
      .sort((a, b) => a.expectedFinishPosition - b.expectedFinishPosition);

    if (!predictions.length) {
      return res.status(503).json({
        success: false,
        code: 'PREDICTION_UNAVAILABLE',
        message: 'PADDOX could not generate a prediction from the selected session.'
      });
    }

    const fallbackCount = predictions.filter(row => row.inferenceSource === 'race_form_fallback').length;
    const primaryCount = predictions.length - fallbackCount;
    const mode = fallbackCount === 0 ? 'lstm' : primaryCount === 0 ? 'race_form_fallback' : 'hybrid';
    const timedDrivers = paceRanks.size;

    return res.json({
      success: true,
      data: {
        year,
        round,
        session,
        coverage: {
          predicted: predictions.length,
          timingRows: rows.length,
          cap: MAX_DRIVERS,
          primaryModelPredictions: primaryCount,
          fallbackPredictions: fallbackCount,
        },
        inputQuality: {
          mode: timedDrivers ? 'partial_live_session_with_pace' : 'session_order_plus_recent_form',
          confidence: timedDrivers >= 5 ? 'medium' : 'guarded',
          recentLapSamplesPerDriver: 'up to 2 from the currently exposed Pit Wall timing row',
          rollingFinishWindow: RECENT_ROUNDS,
          timedDrivers,
          note: timedDrivers
            ? 'Predictions use selected-session order, available lap timing and recent real race finishing averages.'
            : 'This session currently exposes driver order but not usable lap timing. PADDOX therefore uses the live order plus recent real race finishing averages until lap timing arrives.'
        },
        model: {
          algorithm: mode === 'lstm'
            ? 'LSTM race outcome predictor'
            : mode === 'hybrid'
              ? 'PADDOX hybrid race intelligence'
              : 'PADDOX race-form fallback predictor',
          version: mode === 'lstm' ? (predictions[0]?.modelVersion || 'unknown') : 'race-form-v1',
          mode,
          primaryAvailable: primaryCount > 0,
          fallbackActive: fallbackCount > 0,
        },
        predictions,
        warmup,
        generatedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    next(err);
  }
};
