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

    /* Rank currently visible drivers and cap inference fan-out. This protects the
       CPU model from a 20-request burst while still covering the competitive field. */
    const selected = [...rows]
      .sort((a, b) => a.position - b.position)
      .slice(0, MAX_DRIVERS);

    const [rollingMap, warmup] = await Promise.all([
      rollingFinishMap(year, round),
      warmAIService().catch(() => ({ reachable: false }))
    ]);

    const settled = await mapWithConcurrency(selected, 3, async row => {
      const recentLaps = [row.bestSec, row.lastSec]
        .filter(value => Number.isFinite(value) && value > 30 && value < 300);
      const rollingAvg = rollingMap.get(row.code) || row.position;
      const prediction = await predictRace({
        recent_laps: recentLaps,
        features: {
          grid_position: row.position,
          rolling_avg_finish: Number(rollingAvg.toFixed(3)),
          field_size: Math.max(rows.length, 2),
        }
      });

      return {
        code: row.code,
        name: row.name,
        team: row.team,
        currentPosition: row.position,
        lapsAvailable: row.laps,
        recentLapSamplesUsed: recentLaps.length,
        rollingAvgFinish: Number(rollingAvg.toFixed(2)),
        expectedFinishPosition: Number(prediction.expected_finish_position),
        top10Probability: Number(prediction.top10_probability),
        isTop10: Boolean(prediction.is_top10),
        modelVersion: prediction.model_version || 'unknown',
        inferenceLatencyMs: Number(prediction.inference_latency_ms || 0),
        requestId: prediction.request_id || '',
        dataAsOf: prediction.data_as_of || '',
      };
    });

    const predictions = settled
      .filter(result => result?.status === 'fulfilled')
      .map(result => result.value)
      .sort((a, b) => a.expectedFinishPosition - b.expectedFinishPosition);

    if (!predictions.length) {
      const firstError = settled.find(result => result?.status === 'rejected')?.reason;
      const status = Number(firstError?.response?.status || 503);
      return res.status(status === 400 ? 400 : 503).json({
        success: false,
        code: firstError?.response?.data?.status === 'model_not_ready' ? 'MODEL_NOT_READY' : 'AI_NOT_READY',
        message: firstError?.response?.data?.status === 'model_not_ready'
          ? 'The PADDOX LSTM race model is still loading.'
          : 'The PADDOX race prediction service is temporarily unavailable.'
      });
    }

    return res.json({
      success: true,
      data: {
        year,
        round,
        session,
        coverage: { predicted: predictions.length, timingRows: rows.length, cap: MAX_DRIVERS },
        inputQuality: {
          mode: 'partial_live_session',
          confidence: 'medium',
          recentLapSamplesPerDriver: 'up to 2 from the currently exposed Pit Wall timing row',
          rollingFinishWindow: RECENT_ROUNDS,
          note: 'Predictions use real selected-session best/latest lap times plus real recent race finishing averages. The LSTM pads the sequence to its trained 10-lap length when fewer lap samples are available.'
        },
        model: {
          algorithm: 'LSTM race outcome predictor',
          version: predictions[0]?.modelVersion || 'unknown'
        },
        predictions,
        warmup,
        generatedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    if (err.code === 'AI_SERVICE_NOT_CONFIGURED') {
      return res.status(503).json({ success: false, code: 'AI_NOT_CONFIGURED', message: 'PADDOX AI service is not configured.' });
    }
    next(err);
  }
};
