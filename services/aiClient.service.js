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
      timeout: clampTimeout(process.env.AI_FANTASY_TIMEOUT_MS || 30000),
      maxContentLength: 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );
  return response.data;
};

module.exports = {
  askGroundedChat,
  predictFantasy,
  getAIServiceUrl,
  clampTimeout
};
