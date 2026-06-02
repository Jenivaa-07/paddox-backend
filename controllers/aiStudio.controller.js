/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Colab Hugging Face Free API Bridge
   Phase A4.11L
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
    'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash-preview-image-generation'
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
    const clean = new Error('Gemini image generation is temporarily unavailable. Your credits were not deducted.');
    clean.code = err.code || 'GEMINI_GENERATION_UNAVAILABLE';
    clean.status = err.status || 503;
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

function getColabAiBaseUrl() {
  return String(process.env.COLAB_AI_API_URL || process.env.AI_STUDIO_COLAB_URL || '').trim().replace(/\/$/, '');
}

function getColabAiApiKey() {
  return String(process.env.COLAB_AI_API_KEY || '').trim();
}

function getColabAiModel() {
  return String(process.env.COLAB_AI_MODEL || 'black-forest-labs/FLUX.1-schnell').trim();
}

function normalizeExternalImageData(payload = {}) {
  const candidates = [
    payload?.image,
    payload?.image_url,
    payload?.imageUrl,
    payload?.dataUri,
    payload?.data_uri,
    payload?.image_data,
    payload?.imageData,
    payload?.generated_image,
    payload?.output?.image,
    payload?.output?.image_url,
    payload?.output?.imageUrl,
    payload?.output?.dataUri,
    payload?.output?.data_uri,
    payload?.result?.image,
    payload?.result?.image_url,
    payload?.result?.imageUrl,
    payload?.result?.dataUri,
    payload?.result?.data_uri
  ].filter(Boolean);

  for (const item of candidates) {
    const text = String(item || '').trim();
    if (!text) continue;
    if (/^data:image\//i.test(text)) return text;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(text) && text.length > 1000 && !/^https?:\/\//i.test(text)) {
      return `data:image/png;base64,${text.replace(/[\r\n]/g, '')}`;
    }
    if (/^https?:\/\//i.test(text)) return text;
  }
  return '';
}

async function generateWithColabBridge({ prompt, photoDataUrl, aspectRatio, payload = {} }) {
  const baseUrl = getColabAiBaseUrl();
  if (!baseUrl) {
    const error = new Error('COLAB_AI_API_URL is missing. Add your Colab/ngrok API URL in Render environment variables.');
    error.code = 'COLAB_URL_MISSING';
    error.status = 500;
    throw error;
  }

  const size = aspectToSize(aspectRatio || payload?.output?.aspectRatio || '');
  const endpoint = /\/generate$/i.test(baseUrl) ? baseUrl : `${baseUrl}/generate`;
  const apiKey = getColabAiApiKey();

  const requestBody = {
    prompt,
    model: getColabAiModel(),
    aspect_ratio: String(aspectRatio || payload?.output?.aspectRatio || '4:5'),
    width: size.width,
    height: size.height,
    photo_data_url: safePhotoDataUri(photoDataUrl || payload?.references?.fanPhoto?.dataUrl || ''),
    template: payload?.template?.title || '',
    driver_name: payload?.driver?.name || '',
    team_name: payload?.driver?.team || '',
    fan_name: payload?.fan?.name || '',
    meta: {
      provider: 'colab-hf-bridge',
      promptVersion: payload?.promptVersion || '',
      requiresUserPhoto: Boolean(payload?.template?.requiresUserPhoto)
    }
  };

  const response = await axios.post(endpoint, requestBody, {
    timeout: Number(process.env.COLAB_AI_TIMEOUT_MS || 180000),
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    }
  });

  if (response.status < 200 || response.status >= 300) {
    const detail = response.data?.message || response.data?.error || response.data || `HTTP ${response.status}`;
    const error = new Error('Colab AI generation failed.');
    error.code = response.status === 401 || response.status === 403 ? 'COLAB_AUTH_FAILED' : 'COLAB_GENERATION_FAILED';
    error.status = response.status || 503;
    error.model = getColabAiModel();
    error.details = sanitizeGeminiDetail(detail);
    throw error;
  }

  const image = normalizeExternalImageData(response.data || {});
  if (!image) {
    const error = new Error('Colab AI API returned success but no usable image was found.');
    error.code = 'COLAB_NO_IMAGE_RETURNED';
    error.status = 502;
    error.model = getColabAiModel();
    error.details = sanitizeGeminiDetail(response.data || {});
    throw error;
  }

  return {
    dataUri: image,
    model: String(response.data?.model || response.data?.meta?.model || getColabAiModel()),
    provider: 'colab-hf-bridge',
    providerMode: 'colab-hf-free-api',
    text: String(response.data?.message || 'Image created through PADDOX Colab Hugging Face bridge.'),
    meta: response.data?.meta || {}
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

  const apiVersions = String(process.env.GEMINI_API_VERSION || '')
    ? [String(process.env.GEMINI_API_VERSION).trim()]
    : ['v1', 'v1beta'];

  const aspect = getGeminiAspectRatio(aspectRatio);
  const bodies = [
    {
      label: 'stable-response-format',
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseFormat: {
            image: { aspectRatio: aspect }
          }
        }
      }
    },
    {
      label: 'legacy-response-modalities',
      body: {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      }
    }
  ];

  const attempts = [];

  for (const apiVersion of apiVersions) {
    for (const item of bodies) {
      const response = await postGeminiRequest({ apiVersion, model, apiKey, body: item.body });

      if (response.status >= 200 && response.status < 300) {
        try {
          const parsed = readGeminiImageResponse(response, model);
          return { ...parsed, apiVersion, requestMode: item.label };
        } catch (err) {
          attempts.push({
            apiVersion,
            model,
            requestMode: item.label,
            code: err.code,
            status: response.status,
            message: err.message,
            detail: sanitizeGeminiDetail(err.details || response.data)
          });
        }
      } else {
        const detail = response.data?.error || response.data || null;
        const message = response.data?.error?.message || `Gemini request failed with ${response.status}`;
        const code = isGeminiQuotaError(response.status, response.data) ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED';

        attempts.push({
          apiVersion,
          model,
          requestMode: item.label,
          code,
          status: response.status,
          message,
          detail: sanitizeGeminiDetail(detail)
        });

        /* Quota errors will not be fixed by changing request shape for the same key. */
        if (code === 'GEMINI_QUOTA_EXCEEDED') break;
      }
    }
  }

  const last = attempts[attempts.length - 1] || {};
  const err = new Error(last.message || 'Gemini image request failed.');
  err.status = last.status || 503;
  err.details = attempts;
  err.code = attempts.some(a => a.code === 'GEMINI_QUOTA_EXCEEDED') ? 'GEMINI_QUOTA_EXCEEDED' : (last.code || 'GEMINI_REQUEST_FAILED');
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
      const detailList = Array.isArray(err.details) ? err.details : [{ detail: sanitizeGeminiDetail(err.details || err.message) }];
      errors.push({ model, code: err.code, message: err.message, status: err.status, attempts: detailList });

      if (err.code !== 'GEMINI_QUOTA_EXCEEDED' && err.code !== 'GEMINI_REQUEST_FAILED' && err.code !== 'GEMINI_NO_IMAGE_RETURNED') {
        throw err;
      }
    }
  }

  const final = new Error('Gemini image generation is unavailable for this API key/model right now. No PADDOX Credits were used.');
  final.code = errors.some(e => e.code === 'GEMINI_QUOTA_EXCEEDED') ? 'GEMINI_QUOTA_EXCEEDED' : 'GEMINI_REQUEST_FAILED';
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
   Generate image using Gemini only and show it in AI Studio.
   Cloudflare fallback removed to protect PADDOX premium output quality. */
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
    const generated = await generateWithColabBridge({
      prompt,
      photoDataUrl,
      aspectRatio: payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || '',
      payload
    });

    user.aiCredits = Math.max(0, before - cost);
    await user.save({ validateBeforeSave:false });

    const outputSize = aspectToSize(payload.output?.aspectRatio || body.aspectRatio || payload.output?.aspectLabel || '');

    return successResponse(res, 201, 'Colab AI image generated successfully.', {
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
      provider: generated.provider || 'colab-hf-bridge',
      providerMode: generated.providerMode || 'colab-hf-free-api',
      model: generated.model,
      providerText: generated.text,
      savedToDatabase: false,
      fallbackFrom: '',
      providerErrors: [],
      bridgeMeta: generated.meta || {},
      note: 'A4.11L: PADDOX Colab Hugging Face free API bridge. PADDOX Credits deduct only after successful external Colab generation.'
    });
  } catch (err) {
    let currentCredits = null;
    try {
      if (req.user?._id) {
        const freshUser = await User.findById(req.user._id).select('aiCredits');
        currentCredits = freshUser ? normalizeAiCredits(freshUser.aiCredits) : null;
      }
    } catch {}

    console.error('AI Studio Colab bridge generation failed:', err.details || err);
    return res.status(err.status || 503).json({
      success: false,
      message: err.code === 'COLAB_URL_MISSING'
        ? 'Colab AI bridge is not configured yet. Your credits were not deducted.'
        : 'Colab AI generation is temporarily unavailable. Your credits were not deducted.',
      data: {
        provider: 'colab-hf-bridge',
        providerMode: 'colab-hf-free-api',
        model: err.model || getColabAiModel(),
        code: err.code || 'COLAB_GENERATION_UNAVAILABLE',
        aiCredits: currentCredits,
        creditsUsed: 0,
        creditDeducted: false,
        providerErrors: err.details ? [{ message: String(err.details) }] : [],
        bridgeOriginalMessage: err.message || '',
        retryAdvice: 'Check COLAB_AI_API_URL and your Colab/ngrok notebook server. PADDOX Credits remain safe.'
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
