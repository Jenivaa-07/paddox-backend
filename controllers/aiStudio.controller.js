/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — GPT/Gemini Prompt Builder + Fan Upload Rewards
   Phase A4.11N.2 — Revert NVIDIA/FLUX
   ============================================================ */
const User = require('../models/User');
const AiPoster = require('../models/AiPoster');
const { successResponse, errorResponse } = require('../utils/apiResponse');

function serverError(res, err, label = 'AI Studio server error') {
  console.error(label, err);
  return res.status(500).json({ success:false, message: err.message || label });
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
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(text) && text.length <= 8000000) {
    return text.replace(/[\r\n]/g, '');
  }
  return '';
}

function buildPromptFromRequest(body = {}) {
  const payload = body.payload || {};
  const directPrompt = cleanText(body.prompt || payload.prompt || '', 16000);
  if (directPrompt) return directPrompt;

  const driver = payload.driver?.name || body.driverName || 'selected current-grid driver';
  const team = payload.driver?.team || body.teamName || 'selected team';
  const template = payload.template?.title || body.templateTitle || 'PADDOX AI fan visual';
  const aspect = payload.output?.aspectLabel || payload.output?.aspectRatio || body.aspectRatio || '4:5';
  const fanName = payload.fan?.name || body.fanName || 'the fan';
  const tagline = payload.fan?.tagline || body.tagline || 'Create a premium motorsport fan visual';
  const photoUploaded = Boolean(body.photoDataUrl || payload.references?.fanPhoto?.dataUrl || payload.photo?.included || payload.photo?.name);

  return [
    'PADDOX AI STUDIO REQUEST:',
    `Template: ${template}.`,
    `Driver: ${driver}.`,
    `Team: ${team}.`,
    `Output format: ${aspect}.`,
    'Target tool: GPT Image / Gemini Image / any premium AI image generator.',
    '',
    'SCENE:',
    `Create a premium realistic motorsport visual featuring ${fanName} and ${driver}.`,
    `Creative direction: ${tagline}.`,
    `Use authentic ${team} colors, believable Formula 1 paddock/garage/pit-lane atmosphere, premium race-week lighting, and clean editorial composition.`,
    '',
    'IDENTITY / REFERENCE:',
    photoUploaded
      ? `Use the uploaded fan reference photo as the primary identity reference for ${fanName}. Preserve face shape, skin tone, hairstyle, facial hair, and visible accessories as closely as the chosen AI tool allows.`
      : `No fan reference photo is uploaded. Create ${fanName} as a realistic premium fan character.`,
    `${driver} should look realistic and wear a believable ${team} race suit or motorsport outfit.`,
    '',
    'STYLE:',
    'Hyper-realistic, premium sports photography, natural skin texture, crisp facial detail, sharp eyes, realistic anatomy, cinematic depth of field, high-end motorsport brand feeling.',
    '',
    'NEGATIVE:',
    'Avoid cartoon, anime, painting, plastic skin, blurry face, duplicate face, wrong team colors, extra fingers, distorted hands, deformed anatomy, low detail, messy sponsor text, unreadable branding, and overexposed neon glow.'
  ].join('\n');
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

    const prompt = buildPromptFromRequest(req.body || {});
    return successResponse(res, 200, 'GPT/Gemini prompt built successfully.', {
      prompt,
      aiCredits: normalizeAiCredits(user.aiCredits),
      fanPoints: normalizeFanPoints(user.fanPoints),
      provider: 'prompt-builder',
      providerMode: 'gpt-gemini-copy-mode',
      creditsUsed: 0,
      creditsDeducted: false,
      note: 'Live API generation is removed. Copy this prompt to GPT/Gemini or any image tool, then upload your result back to PADDOX to earn Fan Points.'
    });
  } catch (err) {
    return serverError(res, err, 'AI Studio prompt build failed');
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
    await user.save({ validateBeforeSave:false });

    const upload = {
      id: `upload_${Date.now()}`,
      creationTitle: cleanText(body.creationTitle || body.templateTitle || 'PADDOX AI Upload', 140),
      promptTitle: cleanText(body.promptTitle || body.templateTitle || 'PADDOX Prompt', 140),
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
      note: 'Prompt Builder Mode: external AI result upload rewarded successfully.'
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
