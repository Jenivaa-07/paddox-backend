const { askGroundedChat } = require('../services/aiClient.service');
const { buildLiveContext, buildUserContext } = require('../services/chatContext.service');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const SOURCE_LABELS = Object.freeze({
  'paddox_platform_guide.md': 'PADDOX Platform Guide',
  'paddox_faq.md': 'PADDOX Platform FAQ',
  'paddox_shop_policy.md': 'PADDOX Shop & Return Policy',
  'f1_terminology.md': 'Curated F1 Terminology',
  'fia_regulations.md': 'FIA 2026 Regulations',
  'historical_data.md': 'PADDOX Historical Data Guide',
  'live_f1_context': 'Current Formula 1 Data',
  'paddox_profile': 'Your PADDOX Fan Profile',
});

const cleanText = (value, maxLength) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const normalizeQuestion = (value) => typeof value === 'string' ? cleanText(value, 600) : '';

const normalizeHistory = (value) => {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((turn) => {
    if (!turn || !['user', 'assistant'].includes(turn.role)) return null;
    const content = cleanText(turn.content, 1000);
    return content ? { role: turn.role, content } : null;
  }).filter(Boolean);
};

const normalizeSource = (source) => {
  const record = typeof source === 'string' ? { source } : (source || {});
  const id = cleanText(record.id || record.source, 100);
  if (!id) return null;
  return {
    id,
    title: cleanText(record.title || SOURCE_LABELS[id] || 'Verified PADDOX source', 120),
    version: cleanText(record.version, 40),
    date: cleanText(record.date, 24),
  };
};

const normalizeChatPayload = (payload = {}) => {
  const rawSources = Array.isArray(payload.sources)
    ? payload.sources
    : (Array.isArray(payload.retrieved_context_sources) ? payload.retrieved_context_sources : []);
  const sources = rawSources.map(normalizeSource).filter(Boolean).slice(0, 4);
  const grounded = Boolean(payload.grounded) && sources.length > 0;

  return {
    answer: cleanText(payload.answer, 5000) || 'The AI Pit Wall did not return an answer.',
    grounded,
    sources: grounded ? sources : [],
    requestId: cleanText(payload.request_id, 80),
    dataAsOf: cleanText(payload.data_as_of, 40),
    suggestions: (Array.isArray(payload.suggestions) ? payload.suggestions : [])
      .map((item) => cleanText(item, 120))
      .filter(Boolean)
      .slice(0, 3),
  };
};

exports.ask = async (req, res) => {
  const query = normalizeQuestion(req.body?.query);
  const history = normalizeHistory(req.body?.history);
  if (query.length < 2) {
    return errorResponse(res, 400, 'Enter a question with at least 2 characters.');
  }

  try {
    const previousUserQuestion = [...history].reverse().find((turn) => turn.role === 'user')?.content || '';
    const contextQuery = previousUserQuestion ? `${previousUserQuestion}\nFollow-up: ${query}` : query;
    const liveContext = await buildLiveContext(contextQuery).catch((error) => {
      console.warn('AI Pit Wall live context unavailable:', error.message);
      return null;
    });
    const payload = await askGroundedChat(query, {
      history,
      liveContext,
      userContext: buildUserContext(req.user),
    });
    if (payload?.status !== 'success') {
      throw new Error('AI service returned a non-success response');
    }
    return successResponse(res, 200, 'AI Pit Wall response ready', normalizeChatPayload(payload));
  } catch (error) {
    console.error('AI Pit Wall request failed:', error.code || error.message);
    return errorResponse(res, 503, 'The AI Pit Wall is temporarily unavailable. Please try again.');
  }
};

exports.normalizeQuestion = normalizeQuestion;
exports.normalizeHistory = normalizeHistory;
exports.normalizeChatPayload = normalizeChatPayload;
