/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Gemini Quota Clarity + Clean Request Fix
   Phase A4.11H.4.2
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

function getGeminiModel() {
  return String(process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image').trim();
}

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function getGeminiModelCandidates() {
  const configured = String(process.env.GEMINI_IMAGE_MODEL || '').trim();
  return [
    configured || 'gemini-2.5-flash-image'
  ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
}

function getGeminiAspectRatio(aspect = '') {
  const a = String(aspect || '').toLowerCase();
  if (a.includes('1:1')) return '1:1';
  if (a.includes('9:16')) return '9:16';
  if (a.includes('16:9')) return '16:9';
  if (a.includes('21:9')) return '21:9';
  return '4:5';
}

function sanitizeGeminiDetail(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return text
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .slice(0, 1800);
}

function isGeminiQuotaError(status, payload = {}) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return status === 429 ||
    text.includes('quota') ||
    text.includes('resource_exhausted') ||
    text.includes('generate_content_free_tier') ||
    text.includes('free tier');
}

async function generateImageWithGeminiOnly({ prompt, photoDataUrl, aspectRatio }) {
  try {
    const gemini = await generateWithGemini({ prompt, photoDataUrl, aspectRatio });
    return {
      ...gemini,
      provider: 'gemini',
      providerMode: 'gemini-live',
      fallbackFrom: ''
    };
  } catch (err) {
    const quota = err.code === 'GEMINI_QUOTA_EXCEEDED';
    const clean = new Error(
      quota
        ? 'Gemini image quota is exhausted or billing is not enabled for this Google project. Your credits were not deducted.'
        : 'Gemini image generation is temporarily unavailable. Your credits were not deducted.'
    );
    clean.code = err.code || 'GEMINI_GENERATION_UNAVAILABLE';
    clean.status = quota ? 429 : (err.status || 503);
    clean.details = err.details || err.message || '';
    clean.model = err.model || getGeminiModel();
    clean.originalMessage = err.message || '';
    throw clean;
  }
}

function safePhotoDataUri(value = '') {
  const text = String(value || '').trim();
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(text) && text.length < 6000000) {
    return text.replace(/[\r\n]/g, '');
  }
  return '';
}

function splitDataUri(dataUri = '') {
  const match = String(dataUri || '').match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2].replace(/[\r\n]/g, '')
  };
}

function aspectToSize(aspect = '') {
  const a = String(aspect || '').toLowerCase();
  if (a.includes('1:1')) return { width: 1024, height: 1024 };
  if (a.includes('9:16')) return { width: 1024, height: 1792 };
  if (a.includes('16:9')) return { width: 1792, height: 1024 };
  if (a.includes('21:9')) return { width: 1792, height: 768 };
  return { width: 1024, height: 1280 };
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
    'Create a photorealistic, hyper-realistic premium motorsport fan image using the uploaded fan photo as reference when provided.',
    'Keep realistic skin texture, believable lens behavior, motorsport editorial lighting, and clean professional composition.',
    'Avoid cartoon, anime, illustration, plastic skin, distorted fingers, extra limbs, duplicate faces, wrong team colors, messy sponsor text, and blurry identity.'
  ].join('\n');
}

async function postGeminiRequest({ apiVersion, model, apiKey, body }) {
  const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(model)}:generateContent`;

  return axios.post(endpoint, body, {
    timeout: Number(process.env.GEMINI_TIMEOUT_MS || 90000),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    validateStatus: () => true
  });
}

function readGeminiImageResponse(response, model) {
  const candidates = response.data?.candidates || [];
  let text = '';

  for (const candidate of candidates) {
    const candidateParts = candidate?.content?.parts || [];
    text += candidateParts.map(p => p.text).filter(Boolean).join('\n');

    for (const part of candidateParts) {
      const inline = part.inlineData || part.inline_data;
      const mimeType = inline?.mimeType || inline?.mime_type || 'image/png';
      if (inline?.data) {
        return {
          dataUri: `data:${mimeType};base64,${String(inline.data).replace(/[\r\n]/g, '')}`,
          text: text.trim().slice(0, 1200),
          model
        };
      }
    }
  }

  const noImage = new Error(text.trim() || 'Gemini returned text only, not an image.');
  noImage.code = 'GEMINI_NO_IMAGE_RETURNED';
  noImage.model = model;
  noImage.details = response.data || null;
  throw noImage;
}

async function requestGeminiImage({ model, apiKey, prompt, photoDataUrl, aspectRatio }) {
  const parts = [{ text: prompt }];
  const photo = safePhotoDataUri(photoDataUrl);
  const imagePart = splitDataUri(photo);

  if (imagePart) {
    parts.push({
      inline_data: {
        mime_type: imagePart.mimeType,
        data: imagePart.data
      }
    });
  }

  /*
    A4.11H.4.2
    The live error proved v1 + responseFormat and v1 + responseModalities are rejected for this endpoint,
    while v1beta + responseModalities is accepted and reaches Gemini quota checks.
    So we use the clean accepted request shape only. This avoids misleading 400 attempts and makes
    the real blocker clear: free-tier quota/billing/model access.
  */
  const apiVersion = String(process.env.GEMINI_API_VERSION || 'v1beta').trim() || 'v1beta';
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  };

  const response = await postGeminiRequest({ apiVersion, model, apiKey, body });

  if (response.status >= 200 && response.status < 300) {
    return { ...readGeminiImageResponse(response, model), apiVersion, requestMode: 'v1beta-response-modalities' };
  }

  const detail = response.data?.error || response.data || null;
  const message = response.data?.error?.message || `Gemini request failed with ${response.status}`;
  const code = isGeminiQuotaError(response.status, response.data) ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED';

  const err = new Error(message);
  err.status = response.status;
  err.details = [{
    apiVersion,
    model,
    requestMode: 'v1beta-response-modalities',
    code,
    status: response.status,
    message,
    detail: sanitizeGeminiDetail(detail)
  }];
  err.code = code;
  err.model = model;
  throw err;
}

async function generateWithGemini({ prompt, photoDataUrl, aspectRatio }) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is missing. Add it in Render environment variables.');
    error.code = 'GEMINI_KEY_MISSING';
    throw error;
  }

  const models = getGeminiModelCandidates();
  const errors = [];

  for (const model of models) {
    try {
      return await requestGeminiImage({ model, apiKey, prompt, photoDataUrl, aspectRatio });
    } catch (err) {
      const detailList = Array.isArray(err.details)
        ? err.details
        : [{ detail: sanitizeGeminiDetail(err.details || err.message) }];

      errors.push({ model, code: err.code, message: err.message, status: err.status, attempts: detailList });

      /* If Gemini says quota is exhausted/limit is 0, no code patch can generate with this same key/project. */
      if (err.code === 'GEMINI_QUOTA_EXCEEDED') break;

      if (err.code !== 'GEMINI_REQUEST_FAILED' && err.code !== 'GEMINI_NO_IMAGE_RETURNED') {
        throw err;
      }
    }
  }

  const hasQuota = errors.some(e => e.code === 'GEMINI_QUOTA_EXCEEDED');
  const final = new Error(
    hasQuota
      ? 'Gemini image quota is exhausted or billing is not enabled for this Google project. No PADDOX Credits were used.'
      : 'Gemini image generation is unavailable for this API key/model right now. No PADDOX Credits were used.'
  );
  final.code = hasQuota ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED';
  final.details = errors;
  final.model = models[0] || getGeminiModel();
  throw final;
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

/* Phase A4.11I.1:
   Pollinations and Cloudflare removed to protect PADDOX premium quality.
   Gemini-only safe mode remains: credits deduct only after success. */
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
    const photoDataUrl = body.photoDataUrl || payload.references?.fanPhoto?.dataUrl || '';

    const generated = await generateImageWithGeminiOnly({ prompt, photoDataUrl, aspectRatio: payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || "" });

    user.aiCredits = Math.max(0, before - cost);
    await user.save({ validateBeforeSave:false });

    const outputSize = aspectToSize(payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || '');

    return successResponse(res, 201, 'Gemini image generated successfully.', {
      image: {
        url: generated.dataUri,
        dataUri: generated.dataUri,
        width: outputSize.width,
        height: outputSize.height,
        cloudinarySaved: false
      },
      aiCredits: user.aiCredits,
      cost,
      creditsBefore: before,
      creditsAfter: user.aiCredits,
      provider: generated.provider || 'gemini',
      providerMode: generated.providerMode || 'gemini-live',
      model: generated.model,
      apiVersion: generated.apiVersion || '',
      requestMode: generated.requestMode || '',
      providerText: generated.text,
      savedToDatabase: false,
      fallbackFrom: '',
      providerErrors: [],
      note: 'A4.11H.4.2: Gemini-only production mode using the accepted v1beta image request shape. No fallback image is shown if Gemini quota/billing fails.'
    });
  } catch (err) {
    const status = err.code === 'GEMINI_QUOTA_EXCEEDED' ? 429 : 503;

    let currentCredits = null;
    try {
      if (req.user?._id) {
        const freshUser = await User.findById(req.user._id).select('aiCredits');
        currentCredits = freshUser ? normalizeAiCredits(freshUser.aiCredits) : null;
      }
    } catch {}

    console.error('AI Studio Gemini generation failed:', err.details || err);
    return res.status(status).json({
      success: false,
      message: err.message || 'Gemini image generation is temporarily unavailable. Your credits were not deducted.',
      data: {
        provider: 'gemini',
        providerMode: 'gemini-only',
        model: err.model || getGeminiModel(),
        code: err.code || 'GEMINI_GENERATION_UNAVAILABLE',
        aiCredits: currentCredits,
        creditsUsed: 0,
        creditDeducted: false,
        providerErrors: Array.isArray(err.details) ? err.details : [],
        geminiOriginalMessage: err.originalMessage || '',
        retryAdvice: err.code === 'GEMINI_QUOTA_EXCEEDED' ? 'Enable billing/quota for this Google AI project or use a different Gemini project/key with image quota. PADDOX Credits remain safe.' : 'Check providerErrors in the response or Render logs. PADDOX Credits remain safe.'
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
