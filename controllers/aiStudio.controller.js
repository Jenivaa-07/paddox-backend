/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — NVIDIA FLUX Live Provider + Prompt Builder
   Phase A4.11N
   ============================================================ */
const axios = require('axios');
const User = require('../models/User');
const AiPoster = require('../models/AiPoster');
const { successResponse, errorResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'AI Studio server error') {
  console.error(label, err);
  return res.status(500).json({ success: false, message: err.message || label });
}

function cleanText(value = '', max = 12000) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeAiCredits(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeFanPoints(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function safeImageDataUrl(value = '') {
  const text = String(value || '').trim();
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(text) && text.length <= 8_000_000) {
    return text.replace(/[\r\n]/g, '');
  }
  return '';
}

function buildPromptBuilderPrompt(body = {}) {
  const payload = body.payload || {};
  const directPrompt = cleanText(body.prompt || payload.prompt || '', 12000);
  if (directPrompt) return directPrompt;

  const driver = payload.driver?.name || body.driverName || 'selected current-grid driver';
  const team = payload.driver?.team || body.teamName || 'selected team';
  const template = payload.template?.title || body.templateTitle || 'PADDOX AI fan visual';
  const aspect = payload.output?.aspectLabel || payload.output?.aspectRatio || body.aspectRatio || '4:5';
  const fanName = payload.fan?.name || body.fanName || 'the fan';
  const tagline = payload.fan?.tagline || body.tagline || 'Create a premium motorsport fan visual';
  const photoLine = body.photoDataUrl || payload.photo?.included
    ? 'Fan reference photo is uploaded and should guide the fan appearance.'
    : 'No fan reference photo is uploaded.';

  return [
    'PADDOX AI STUDIO REQUEST:',
    `Template: ${template}.`,
    `Driver: ${driver}.`,
    `Team: ${team}.`,
    `Output format: ${aspect}.`,
    '',
    `Create a premium realistic motorsport visual featuring ${fanName}.`,
    `Creative direction: ${tagline}.`,
    photoLine,
    'Keep the look hyper-realistic, premium, clean, and believable.',
    'Avoid cartoonish rendering, duplicate faces, wrong team colors, broken anatomy, low-detail skin, and messy sponsor text.'
  ].join('\n');
}

function buildFluxPrompt(body = {}) {
  const payload = body.payload || {};
  const selectedTemplate = payload.template || {};
  const driver = payload.driver || {};
  const fan = payload.fan || {};
  const aspect = payload.output?.aspectRatio || body.aspectRatio || '4:5';
  const templateTitle = cleanText(selectedTemplate.title || body.templateTitle || 'PADDOX motorsport visual', 160);
  const team = cleanText(driver.team || body.teamName || 'Formula 1 team', 120);
  const driverName = cleanText(driver.name || body.driverName || 'Formula 1 driver', 120);
  const fanName = cleanText(fan.name || body.fanName || 'fan', 120);
  const tagline = cleanText(fan.tagline || body.tagline || '', 220);
  const photoUploaded = Boolean(body.photoDataUrl || payload.photo?.included || payload.photo?.name);
  const promptHints = [];

  promptHints.push(`Photorealistic premium Formula 1 visual for PADDOX, template style: ${templateTitle}.`);

  const templateId = String(selectedTemplate.id || '').toLowerCase();
  if (templateId.includes('selfie')) {
    promptHints.push(`Nighttime Formula 1 pit lane smartphone selfie featuring ${fanName} and ${driverName}.`);
    promptHints.push('Front-camera selfie framing, shoulders-up close crop, both faces large in frame, slight wide-angle phone distortion, natural candid selfie energy.');
  } else if (templateId.includes('podium')) {
    promptHints.push(`${driverName} in a podium celebration scene with a premium racing atmosphere.`);
    promptHints.push('Heroic close-up sports photography framing, trophy celebration energy, realistic crowd and lights in the background.');
  } else if (templateId.includes('helmet') || templateId.includes('cockpit')) {
    promptHints.push(`${driverName} in a dramatic Formula 1 helmet or cockpit inspired scene.`);
    promptHints.push('High-detail close-up framing, premium motorsport lighting, cinematic composition.');
  } else {
    promptHints.push(`${driverName} featured in a premium Formula 1 themed scene with ${fanName}.`);
    promptHints.push('Balanced close-up composition, premium sports photography, authentic paddock atmosphere.');
  }

  promptHints.push(`Show realistic ${team} styling, believable team colors, motorsport detailing, and an authentic Formula 1 environment.`);

  if (photoUploaded) {
    promptHints.push(`Use the uploaded fan photo as identity guidance for ${fanName}; preserve the fan's general facial structure, skin tone, hairstyle, facial hair, and visible accessories as closely as possible.`);
  }

  promptHints.push(`${driverName} should have a realistic facial likeness and wear a believable ${team} race suit or motorsport outfit.`);
  if (tagline) promptHints.push(`Creative mood: ${tagline}.`);

  promptHints.push(`Output ratio ${aspect}. Real smartphone or sports-photography lighting, crisp facial detail, natural skin texture, sharp eyes, premium realistic image quality.`);
  promptHints.push('Negative: distant shot, full body only, studio portrait, cartoon, painting, blurry face, duplicate face, extra fingers, distorted hands, deformed anatomy, low detail, incorrect team colors.');

  return promptHints.join(' ');
}

function getRequestedCost(body = {}) {
  const value = Number(body.cost ?? body.creditCost ?? body.payload?.template?.creditCost ?? 50);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 50;
}

function pickNvidiaOutputSize(aspectRatio = '4:5') {
  const ratio = String(aspectRatio || '4:5').trim();
  const map = {
    '1:1': { width: 1024, height: 1024, label: '1024x1024' },
    '4:5': { width: 832, height: 1248, label: '832x1248' },
    '5:4': { width: 1248, height: 832, label: '1248x832' },
    '3:2': { width: 1248, height: 832, label: '1248x832' },
    '2:3': { width: 832, height: 1248, label: '832x1248' },
    '16:9': { width: 1392, height: 752, label: '1392x752' },
    '9:16': { width: 752, height: 1392, label: '752x1392' }
  };
  return map[ratio] || map['4:5'];
}

function providerEnabled() {
  return ((process.env.AI_IMAGE_PROVIDER || '').toLowerCase() === 'nvidia' || Boolean(process.env.NVIDIA_API_KEY));
}

function extractBase64Image(value, depth = 0) {
  if (!value || depth > 6) return '';

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return '';
    if (text.startsWith('data:image/')) return text;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(text) && text.replace(/[\r\n]/g, '').length > 500) {
      return `data:image/png;base64,${text.replace(/[\r\n]/g, '')}`;
    }
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractBase64Image(item, depth + 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof value === 'object') {
    const priorityKeys = ['image', 'image_base64', 'base64', 'b64_json', 'dataUri', 'data_url', 'url'];
    for (const key of priorityKeys) {
      const found = extractBase64Image(value[key], depth + 1);
      if (found) return found;
    }
    for (const child of Object.values(value)) {
      const found = extractBase64Image(child, depth + 1);
      if (found) return found;
    }
  }

  return '';
}

function summarizeAxiosError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const rawMessage = data?.message || data?.error || err?.message || 'Unknown provider error';
  return {
    status,
    data,
    message: typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage)
  };
}

async function invokeNvidiaFlux({ prompt, aspectRatio }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('Missing NVIDIA_API_KEY');

  const endpoint = process.env.NVIDIA_IMAGE_ENDPOINT || 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b';
  const model = process.env.NVIDIA_IMAGE_MODEL || 'flux.2-klein-4b';
  const timeout = Number(process.env.NVIDIA_TIMEOUT_MS || 120000);
  const steps = Number(process.env.NVIDIA_STEPS || 4);
  const seed = Number(process.env.NVIDIA_SEED || 0);
  const size = pickNvidiaOutputSize(aspectRatio);

  const payload = {
    prompt,
    width: size.width,
    height: size.height,
    seed,
    steps
  };

  const response = await axios.post(endpoint, payload, {
    timeout,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  });

  const imageDataUrl = extractBase64Image(response.data);
  return {
    model,
    endpoint,
    size,
    payload,
    raw: response.data,
    imageDataUrl
  };
}

exports.getCredits = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('firstName lastName email aiCredits fanPoints');
    if (!user) return errorResponse(res, 404, 'User not found');

    return successResponse(res, 200, 'AI credits synced', {
      aiCredits: normalizeAiCredits(user.aiCredits),
      fanPoints: normalizeFanPoints(user.fanPoints),
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        aiCredits: normalizeAiCredits(user.aiCredits),
        fanPoints: normalizeFanPoints(user.fanPoints)
      }
    });
  } catch (err) {
    return serverError(res, err, 'AI credits sync failed');
  }
};

exports.generatePoster = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('aiCredits fanPoints');
    if (!user) return errorResponse(res, 404, 'User not found');

    const body = req.body || {};
    const generationMode = String(body.generationMode || body.mode || 'prompt_builder').toLowerCase();
    const prompt = buildPromptBuilderPrompt(body);
    const nvidiaPrompt = buildFluxPrompt(body);
    const currentCredits = normalizeAiCredits(user.aiCredits);
    const fanPoints = normalizeFanPoints(user.fanPoints);
    const cost = getRequestedCost(body);
    const liveAvailable = providerEnabled();

    if (generationMode !== 'nvidia_live') {
      return successResponse(res, 200, 'AI Studio prompt built successfully.', {
        prompt,
        nvidiaPrompt,
        aiCredits: currentCredits,
        fanPoints,
        provider: 'prompt-builder-beta',
        providerMode: 'manual-external-generation',
        liveProviderAvailable: liveAvailable,
        creditsUsed: 0,
        creditsDeducted: false,
        note: liveAvailable
          ? 'Prompt Builder ready. You can also use NVIDIA Beta live generation.'
          : 'Live image generation is unavailable. Copy this prompt, generate in any external AI tool, then upload your result back to PADDOX to earn Fan Points.'
      });
    }

    if (!liveAvailable || !process.env.NVIDIA_API_KEY) {
      return successResponse(res, 200, 'NVIDIA provider is not configured yet. Prompt Builder fallback returned.', {
        prompt,
        nvidiaPrompt,
        aiCredits: currentCredits,
        fanPoints,
        provider: 'prompt-builder-beta',
        providerMode: 'manual-external-generation',
        liveProviderAvailable: false,
        creditsUsed: 0,
        creditsDeducted: false,
        note: 'Add NVIDIA env values in Render to enable live FLUX generation. Prompt Builder fallback is active.'
      });
    }

    if (currentCredits < cost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient PADDOX AI Credits. Required: ${cost}. Available: ${currentCredits}.`,
        data: {
          aiCredits: currentCredits,
          fanPoints,
          provider: 'nvidia',
          providerMode: 'nvidia_live',
          creditsDeducted: false,
          prompt,
          nvidiaPrompt
        }
      });
    }

    try {
      const live = await invokeNvidiaFlux({ prompt: nvidiaPrompt, aspectRatio: body.aspectRatio || body.payload?.output?.aspectRatio || '4:5' });
      if (!live.imageDataUrl) throw new Error('NVIDIA response did not include a usable image payload.');

      user.aiCredits = currentCredits - cost;
      await user.save({ validateBeforeSave: false });

      return successResponse(res, 200, 'NVIDIA FLUX image generated successfully.', {
        prompt,
        nvidiaPrompt,
        aiCredits: normalizeAiCredits(user.aiCredits),
        fanPoints,
        provider: 'nvidia',
        providerMode: 'nvidia_live',
        model: live.model,
        liveProviderAvailable: true,
        creditsUsed: cost,
        creditsDeducted: true,
        outputSize: live.size,
        image: {
          dataUri: live.imageDataUrl,
          url: live.imageDataUrl
        },
        note: 'NVIDIA beta generation succeeded. PADDOX credits were deducted only after success.'
      });
    } catch (providerErr) {
      const details = summarizeAxiosError(providerErr);
      return res.status(503).json({
        success: false,
        message: 'NVIDIA FLUX generation failed. Your PADDOX credits were not deducted.',
        data: {
          aiCredits: currentCredits,
          fanPoints,
          provider: 'nvidia',
          providerMode: 'nvidia_live',
          model: process.env.NVIDIA_IMAGE_MODEL || 'flux.2-klein-4b',
          liveProviderAvailable: true,
          creditsUsed: 0,
          creditsDeducted: false,
          prompt,
          nvidiaPrompt,
          code: details.status || 'NVIDIA_ERROR',
          providerErrors: [
            {
              message: details.message,
              status: details.status,
              details: details.data || null
            }
          ],
          retryAdvice: 'Check NVIDIA_API_KEY, NVIDIA endpoint, request limits, and supported output ratios.'
        }
      });
    }
  } catch (err) {
    return serverError(res, err, 'AI Studio generation failed');
  }
};

exports.uploadResult = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('aiCredits fanPoints firstName lastName email');
    if (!user) return errorResponse(res, 404, 'User not found');

    const body = req.body || {};
    const imageDataUrl = safeImageDataUrl(body.imageDataUrl || body.image || '');
    if (!imageDataUrl) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a valid AI-generated image file.'
      });
    }

    const pointsAwarded = Number.isFinite(Number(body.pointsAwarded)) ? Math.max(0, Math.round(Number(body.pointsAwarded))) : 50;
    const fanPointsBefore = normalizeFanPoints(user.fanPoints);
    user.fanPoints = fanPointsBefore + pointsAwarded;
    await user.save({ validateBeforeSave: false });

    const creationTitle = cleanText(body.creationTitle || body.templateTitle || 'PADDOX AI Upload', 140);
    const promptTitle = cleanText(body.promptTitle || body.templateTitle || creationTitle, 140);
    const upload = {
      id: `upload_${Date.now()}`,
      creationTitle,
      promptTitle,
      driverName: cleanText(body.driverName || body.driver?.name || '', 120),
      teamName: cleanText(body.teamName || body.driver?.team || '', 120),
      pointsAwarded,
      createdAt: new Date().toISOString(),
      imageSaved: false,
      status: 'rewarded'
    };

    return successResponse(res, 201, 'AI result uploaded and Fan Points awarded.', {
      upload,
      fanPoints: normalizeFanPoints(user.fanPoints),
      fanPointsBefore,
      fanPointsAfter: normalizeFanPoints(user.fanPoints),
      pointsAwarded,
      aiCredits: normalizeAiCredits(user.aiCredits),
      note: 'External AI result upload rewarded successfully.'
    });
  } catch (err) {
    return serverError(res, err, 'AI result upload failed');
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
