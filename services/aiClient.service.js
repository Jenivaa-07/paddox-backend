const axios = require('axios');

const clampTimeout = (value) => Math.min(60000, Math.max(5000, Number(value) || 30000));

const getAIServiceUrl = () => String(process.env.AI_SERVICE_URL || '').trim().replace(/\/$/, '');

const getAIHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AI_SERVICE_KEY) {
    headers['X-Paddox-AI-Key'] = process.env.AI_SERVICE_KEY;
  }
  return headers;
};

const requireAIServiceUrl = () => {
  const baseUrl = getAIServiceUrl();
  if (!baseUrl) {
    const error = new Error('AI service URL is not configured');
    error.code = 'AI_SERVICE_NOT_CONFIGURED';
    throw error;
  }
  return baseUrl;
};

const warmAIService = async () => {
  const baseUrl = requireAIServiceUrl();
  try {
    const response = await axios.get(`${baseUrl}/health`, {
      timeout: clampTimeout(process.env.AI_WARMUP_TIMEOUT_MS || 15000),
      maxContentLength: 256 * 1024,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    return {
      reachable: response.status >= 200 && response.status < 500,
      status: response.status
    };
  } catch (error) {
    return {
      reachable: false,
      status: Number(error.response?.status || 0),
      code: error.code || 'AI_WARMUP_FAILED'
    };
  }
};

const askGroundedChat = async (query, context = {}) => {
  const baseUrl = requireAIServiceUrl();
  const response = await axios.post(
    `${baseUrl}/chat`,
    {
      query,
      history: Array.isArray(context.history) ? context.history : [],
      ...(context.liveContext ? { live_context: context.liveContext } : {}),
      ...(context.userContext ? { user_context: context.userContext } : {}),
    },
    {
      headers: getAIHeaders(),
      timeout: clampTimeout(process.env.AI_CHAT_TIMEOUT_MS),
      maxContentLength: 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );
  return response.data;
};

const predictFantasy = async (payload = {}) => {
  const baseUrl = requireAIServiceUrl();
  const response = await axios.post(
    `${baseUrl}/predict-fantasy`,
    payload,
    {
      headers: getAIHeaders(),
      timeout: clampTimeout(process.env.AI_FANTASY_TIMEOUT_MS || 45000),
      maxContentLength: 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );
  return response.data;
};

const predictRace = async (payload = {}) => {
  const baseUrl = requireAIServiceUrl();
  const response = await axios.post(
    `${baseUrl}/predict-race`,
    payload,
    {
      headers: getAIHeaders(),
      timeout: clampTimeout(process.env.AI_RACE_TIMEOUT_MS || 45000),
      maxContentLength: 512 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );
  return response.data;
};

module.exports = {
  askGroundedChat,
  predictFantasy,
  predictRace,
  warmAIService,
  getAIServiceUrl,
  clampTimeout
};
