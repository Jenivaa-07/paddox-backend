/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Gemini Free Generation Connect
   Phase A4.11H
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
    configured,
    'gemini-2.5-flash-image',
    'gemini-2.0-flash-preview-image-generation'
  ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
}

function isGeminiQuotaError(status, payload = {}) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return status === 429 ||
    text.includes('quota') ||
    text.includes('resource_exhausted') ||
    text.includes('generate_content_free_tier') ||
    text.includes('free tier');
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

async function requestGeminiImage({ model, apiKey, prompt, photoDataUrl }) {
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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await axios.post(endpoint, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  }, {
    timeout: Number(process.env.GEMINI_TIMEOUT_MS || 90000),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const msg = response.data?.error?.message || `Gemini request failed with ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.details = response.data?.error || response.data || null;
    err.code = isGeminiQuotaError(response.status, response.data) ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED';
    err.model = model;
    throw err;
  }

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
  throw noImage;
}

async function generateWithGemini({ prompt, photoDataUrl }) {
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
      return await requestGeminiImage({ model, apiKey, prompt, photoDataUrl });
    } catch (err) {
      errors.push({ model, code: err.code, message: err.message, status: err.status });
      /* If one model has free-tier quota exhausted, try the next image-capable model once. */
      if (err.code !== 'GEMINI_QUOTA_EXCEEDED' && err.code !== 'GEMINI_REQUEST_FAILED') {
        throw err;
      }
    }
  }

  const final = new Error('Gemini free image quota is exhausted or unavailable for this API key. No PADDOX Credits were used.');
  final.code = 'GEMINI_QUOTA_EXCEEDED';
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

/* Phase A4.11H — Option 1 Simple:
   Generate image and show it in AI Studio only.
   No AiPoster database save and no Account sync in this phase. */
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

    const gemini = await generateWithGemini({ prompt, photoDataUrl });

    user.aiCredits = Math.max(0, before - cost);
    await user.save({ validateBeforeSave:false });

    const outputSize = aspectToSize(payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || '');

    return successResponse(res, 201, 'Gemini image generated successfully.', {
      image: {
        url: gemini.dataUri,
        dataUri: gemini.dataUri,
        width: outputSize.width,
        height: outputSize.height,
        cloudinarySaved: false
      },
      aiCredits: user.aiCredits,
      cost,
      creditsBefore: before,
      creditsAfter: user.aiCredits,
      provider: 'gemini',
      providerMode: 'live-simple',
      model: gemini.model,
      geminiText: gemini.text,
      savedToDatabase: false,
      note: 'A4.11H Option 1: generated image is returned directly to AI Studio only.'
    });
  } catch (err) {
    const status =
      err.code === 'GEMINI_KEY_MISSING' ? 503 :
      err.code === 'GEMINI_QUOTA_EXCEEDED' ? 429 :
      500;

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
      message: err.message || 'Gemini generation failed',
      data: {
        provider: 'gemini',
        providerMode: 'live-simple',
        model: err.model || getGeminiModel(),
        code: err.code || 'GEMINI_GENERATION_FAILED',
        aiCredits: currentCredits,
        creditsUsed: 0,
        creditDeducted: false,
        retryAdvice: err.code === 'GEMINI_QUOTA_EXCEEDED'
          ? 'Gemini free image quota is exhausted for this key/model. Wait for quota reset or use another API key/model.'
          : ''
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
