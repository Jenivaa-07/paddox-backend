/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Pollinations Free Provider Integration
   Phase A4.11I
   ============================================================ */
const User = require('../models/User');
const AiPoster = require('../models/AiPoster');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const axios = require('axios');

function serverError(res, err, label = 'AI Studio server error') {
  console.error(label, err);
  return res.status(500).json({ success:false, message: err.message || label });
}

function cleanText(value = '', max = 8000) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeAiCredits(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 50;
}

function safeCost(value, fallback = 30) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function aspectToSize(aspect = '') {
  const a = String(aspect || '').toLowerCase();
  if (a.includes('1:1')) return { width: 1024, height: 1024 };
  if (a.includes('9:16')) return { width: 1024, height: 1792 };
  if (a.includes('16:9')) return { width: 1792, height: 1024 };
  if (a.includes('21:9')) return { width: 1792, height: 768 };
  return { width: 1024, height: 1280 };
}

function getPollinationsModel() {
  return String(process.env.POLLINATIONS_IMAGE_MODEL || 'flux').trim() || 'flux';
}

function getPollinationsApiKey() {
  return String(process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY || '').trim();
}

function getPollinationsEndpoint() {
  return String(process.env.POLLINATIONS_IMAGE_ENDPOINT || 'https://gen.pollinations.ai/image').replace(/\/+$/, '');
}

function sanitizeProviderDetail(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return text
    .replace(/(key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(POLLINATIONS[_A-Z]*KEY["'\s:=]+)[^"'\s,}]+/gi, '$1[REDACTED]')
    .slice(0, 1800);
}

function simplifyPromptForPollinations(prompt = '', body = {}) {
  const payload = body.payload || {};
  const driver = payload.driver || {};
  const template = payload.template || {};
  const fan = payload.fan || {};
  const output = payload.output || {};

  const raw = String(prompt || '')
    .replace(/PADDOX AI STUDIO REQUEST:/gi, '')
    .replace(/FAN IDENTITY LOCK[\s\S]*?(?=CURRENT GRID DRIVER IDENTITY|COMPOSITION AND OUTPUT|QUALITY AND REALISM LOCK|$)/gi, '')
    .replace(/SELFIE NEGATIVE COMPOSITION RULES:/gi, '')
    .replace(/avoid[^.]{0,220}\./gi, '')
    .replace(/\r\n/g, '\n');

  const identityHint = fan?.name
    ? `Create the fan as a realistic motorsport fan named ${fan.name}.`
    : 'Create a realistic motorsport fan as the main subject.';

  const essentials = [
    `Premium hyper-realistic Formula racing fan poster for PADDOX.`,
    `Scene/template: ${template.title || 'Night Pit Lane Selfie'}.`,
    `Driver inspiration: ${driver.name || 'current grid driver'} from ${driver.team || 'Formula racing team'}.`,
    driver.faceDescription ? `Driver face description: ${driver.faceDescription}.` : '',
    driver.racingSuitDescription ? `Race suit: ${driver.racingSuitDescription}.` : '',
    driver.garageDescription ? `Garage/background: ${driver.garageDescription}.` : '',
    identityHint,
    `Output: ${output.aspectLabel || output.aspectRatio || 'portrait 4:5 poster'}.`,
    `Style: realistic sports photography, cinematic pit lane lighting, sharp face detail, natural skin texture, shallow depth of field, premium black red graphite motorsport mood, no logos, no watermark, no broken text.`,
    raw
  ].filter(Boolean).join(' ');

  return cleanText(essentials, Number(process.env.POLLINATIONS_PROMPT_MAX || 1800));
}

function isPollinationsRetryable(status, payload = '') {
  const text = String(typeof payload === 'string' ? payload : JSON.stringify(payload || {})).toLowerCase();
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 ||
    text.includes('timeout') || text.includes('busy') || text.includes('rate') || text.includes('limit');
}

async function generateWithPollinations({ prompt, body, aspectRatio }) {
  const size = aspectToSize(aspectRatio);
  const model = getPollinationsModel();
  const apiKey = getPollinationsApiKey();
  const endpoint = getPollinationsEndpoint();
  const pollPrompt = simplifyPromptForPollinations(prompt, body);
  const seed = String(Date.now()).slice(-9);

  const params = new URLSearchParams({
    model,
    width: String(size.width),
    height: String(size.height),
    seed,
    enhance: String(process.env.POLLINATIONS_ENHANCE || 'false'),
    nologo: 'true',
    private: 'true',
    safe: String(process.env.POLLINATIONS_SAFE || 'false')
  });

  if (apiKey) params.set('key', apiKey);
  if (process.env.POLLINATIONS_REFERRER) params.set('referrer', String(process.env.POLLINATIONS_REFERRER));

  const url = `${endpoint}/${encodeURIComponent(pollPrompt)}?${params.toString()}`;

  const response = await axios.get(url, {
    timeout: Number(process.env.POLLINATIONS_TIMEOUT_MS || 120000),
    responseType: 'arraybuffer',
    headers: {
      Accept: 'image/*,application/json,text/plain,*/*',
      'User-Agent': 'PADDOX-AI-Studio/1.0'
    },
    validateStatus: () => true
  });

  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();

  if (response.status < 200 || response.status >= 300) {
    let detail = '';
    try { detail = Buffer.from(response.data || '').toString('utf8'); } catch {}
    const err = new Error(detail || `Pollinations request failed with ${response.status}`);
    err.status = response.status;
    err.code = isPollinationsRetryable(response.status, detail) ? 'POLLINATIONS_TEMPORARILY_UNAVAILABLE' : 'POLLINATIONS_REQUEST_FAILED';
    err.details = [{ model, status: response.status, message: sanitizeProviderDetail(detail), endpoint: endpoint.replace(/^https?:\/\//, '') }];
    err.model = model;
    throw err;
  }

  if (!contentType.includes('image')) {
    const text = Buffer.from(response.data || '').toString('utf8');
    const err = new Error(text || 'Pollinations did not return an image.');
    err.status = response.status;
    err.code = 'POLLINATIONS_NO_IMAGE_RETURNED';
    err.details = [{ model, status: response.status, message: sanitizeProviderDetail(text) }];
    err.model = model;
    throw err;
  }

  const mime = contentType.split(';')[0] || 'image/png';
  const base64 = Buffer.from(response.data).toString('base64');

  return {
    dataUri: `data:${mime};base64,${base64}`,
    text: 'Pollinations free provider image generated. Fan upload is not used as an image reference in free URL mode; it is used only for local prompt context.',
    model,
    provider: 'pollinations',
    providerMode: 'pollinations-free',
    promptUsed: pollPrompt,
    width: size.width,
    height: size.height,
    seed,
    endpoint: endpoint.replace(/^https?:\/\//, '')
  };
}

function buildPromptFromRequest(body = {}) {
  const payload = body.payload || {};
  const prompt = cleanText(body.prompt || payload.prompt || '', 12000);
  if (prompt) return prompt;

  const driver = payload.driver?.name || body.driverName || 'selected current-grid driver';
  const team = payload.driver?.team || body.teamName || 'selected team';
  const template = payload.template?.title || body.templateTitle || 'PADDOX AI fan poster';
  const output = payload.output?.aspectLabel || body.outputFormat || 'Portrait Poster, 4:5 aspect ratio';

  return [
    'PADDOX AI STUDIO REQUEST:',
    `Template: ${template}.`,
    `Current-grid driver: ${driver}.`,
    `Team: ${team}.`,
    `Output format: ${output}.`,
    '',
    'Create a photorealistic, hyper-realistic premium motorsport fan image.',
    'Keep realistic skin texture, believable lens behavior, motorsport editorial lighting, and clean professional composition.',
    'Avoid cartoon, anime, illustration, plastic skin, distorted fingers, extra limbs, duplicate faces, wrong team colors, messy sponsor text, and blurry identity.'
  ].join('\n');
}

/* Phase A4.11H.1 — Real credits sync endpoint for AI Studio frontend. */
exports.getCredits = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('firstName lastName email aiCredits');
    if (!user) return errorResponse(res, 404, 'User not found');

    return successResponse(res, 200, 'AI credits synced', {
      aiCredits: normalizeAiCredits(user.aiCredits),
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        aiCredits: normalizeAiCredits(user.aiCredits)
      }
    });
  } catch (err) {
    return serverError(res, err, 'AI credits sync failed');
  }
};

/* Phase A4.11I:
   Generate image using Pollinations free provider.
   Cloudflare removed. Gemini kept out of active generation until quota is available. */
exports.generatePoster = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return errorResponse(res, 404, 'User not found');

    const body = req.body || {};
    const payload = body.payload || {};
    const cost = safeCost(body.cost || payload.template?.creditCost || 30, 30);
    const before = normalizeAiCredits(user.aiCredits);

    if (before < cost) {
      return res.status(402).json({
        success: false,
        message: `Not enough PADDOX Credits. You need ${cost} credits.`,
        data: { aiCredits: before, required: cost }
      });
    }

    const prompt = buildPromptFromRequest(body);
    const aspectRatio = payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || '';
    const generated = await generateWithPollinations({ prompt, body, aspectRatio });

    user.aiCredits = Math.max(0, before - cost);
    await user.save({ validateBeforeSave:false });

    return successResponse(res, 201, 'Pollinations image generated successfully.', {
      image: {
        url: generated.dataUri,
        dataUri: generated.dataUri,
        width: generated.width,
        height: generated.height,
        cloudinarySaved: false
      },
      aiCredits: user.aiCredits,
      cost,
      creditsBefore: before,
      creditsAfter: user.aiCredits,
      provider: 'pollinations',
      providerMode: 'pollinations-free',
      model: generated.model,
      seed: generated.seed,
      endpoint: generated.endpoint,
      providerText: generated.text,
      promptUsed: generated.promptUsed,
      savedToDatabase: false,
      fallbackFrom: '',
      providerErrors: [],
      note: 'A4.11I: Pollinations free provider mode. Credits deduct only after a real image response. No Cloudflare fallback.'
    });
  } catch (err) {
    let currentCredits = null;
    try {
      if (req.user?._id) {
        const freshUser = await User.findById(req.user._id).select('aiCredits');
        currentCredits = freshUser ? normalizeAiCredits(freshUser.aiCredits) : null;
      }
    } catch {}

    console.error('AI Studio Pollinations generation failed:', err.details || err);
    return res.status(err.status && err.status < 500 ? 502 : 503).json({
      success: false,
      message: 'Pollinations image generation is temporarily unavailable. Your credits were not deducted.',
      data: {
        provider: 'pollinations',
        providerMode: 'pollinations-free',
        model: err.model || getPollinationsModel(),
        code: err.code || 'POLLINATIONS_GENERATION_UNAVAILABLE',
        aiCredits: currentCredits,
        creditsUsed: 0,
        creditDeducted: false,
        providerErrors: Array.isArray(err.details) ? err.details : [{ message: sanitizeProviderDetail(err.message || '') }],
        retryAdvice: 'Pollinations free provider may be busy or may require POLLINATIONS_API_KEY depending on your account. PADDOX Credits remain safe.'
      }
    });
  }
};

exports.getMyPosters = async (req, res) => {
  try {
    const posters = await AiPoster.find({ user: req.user._id, status: { $ne: 'deleted' } })
      .sort('-createdAt')
      .limit(30);

    return successResponse(res, 200, 'AI posters fetched', { posters });
  } catch (err) {
    return serverError(res, err, 'AI posters fetch failed');
  }
};
