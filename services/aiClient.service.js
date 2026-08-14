const axios = require('axios');

const clampTimeout = (value) => Math.min(60000, Math.max(5000, Number(value) || 30000));

const getAIServiceUrl = () => String(process.env.AI_SERVICE_URL || '').trim().replace(/\/$/, '');

const askGroundedChat = async (query) => {
  const baseUrl = getAIServiceUrl();
  if (!baseUrl) {
    const error = new Error('AI service URL is not configured');
    error.code = 'AI_SERVICE_NOT_CONFIGURED';
    throw error;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.AI_SERVICE_KEY) {
    headers['X-Paddox-AI-Key'] = process.env.AI_SERVICE_KEY;
  }

  const response = await axios.post(
    `${baseUrl}/chat`,
    { query },
    {
      headers,
      timeout: clampTimeout(process.env.AI_CHAT_TIMEOUT_MS),
      maxContentLength: 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    }
  );

  return response.data;
};

module.exports = { askGroundedChat, getAIServiceUrl, clampTimeout };
