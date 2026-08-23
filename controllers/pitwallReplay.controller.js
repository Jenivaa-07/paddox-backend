const axios = require('axios');

const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const AI_SERVICE_KEY = String(process.env.AI_SERVICE_KEY || '').trim();
const REPLAY_TIMEOUT_MS = Math.max(30000, Number(process.env.AI_REPLAY_TIMEOUT_MS || 240000));

function aiHeaders() {
  return {
    Accept: 'application/json',
    ...(AI_SERVICE_KEY ? { 'X-Paddox-AI-Key': AI_SERVICE_KEY } : {}),
  };
}

function cleanSession(value) {
  const text = String(value || 'Race').trim();
  return text.slice(0, 32) || 'Race';
}

function cleanYear(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2018 || n > 2030) return null;
  return n;
}

function cleanRound(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 30) return null;
  return n;
}

function forwardError(err, next) {
  const upstreamStatus = Number(err.response?.status || 0);
  const detail = err.response?.data?.detail || err.response?.data?.message || err.message || 'Replay service unavailable';
  const wrapped = new Error(String(detail));
  if (upstreamStatus === 404) wrapped.statusCode = 404;
  else if (upstreamStatus === 401 || upstreamStatus === 403) wrapped.statusCode = 502;
  else if (err.code === 'ECONNABORTED') wrapped.statusCode = 504;
  else wrapped.statusCode = 503;
  next(wrapped);
}

exports.getManifest = async (req, res, next) => {
  const year = cleanYear(req.query.year);
  const round = cleanRound(req.query.round);
  const session = cleanSession(req.query.session);
  if (!year || !round) return res.status(400).json({ success: false, message: 'Valid year and round are required.' });

  try {
    const response = await axios.get(`${AI_SERVICE_URL}/pitwall/replay/manifest`, {
      params: { year, round, session },
      headers: aiHeaders(),
      timeout: REPLAY_TIMEOUT_MS,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: 'FastF1 replay manifest ready', data: response.data });
  } catch (err) {
    forwardError(err, next);
  }
};

exports.getFrame = async (req, res, next) => {
  const year = cleanYear(req.query.year);
  const round = cleanRound(req.query.round);
  const session = cleanSession(req.query.session);
  const at = Math.max(0, Number(req.query.at || 0));
  if (!year || !round || !Number.isFinite(at)) return res.status(400).json({ success: false, message: 'Valid replay parameters are required.' });

  try {
    const response = await axios.get(`${AI_SERVICE_URL}/pitwall/replay/frame`, {
      params: { year, round, session, at },
      headers: aiHeaders(),
      timeout: Math.min(REPLAY_TIMEOUT_MS, 45000),
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: 'FastF1 replay frame fetched', data: response.data });
  } catch (err) {
    forwardError(err, next);
  }
};
