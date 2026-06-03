/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Prompt Studio + Fan Upload Rewards
   Phase A4.11M
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
    .replace(/
/g, '
')
    .replace(/[ 	]+/g, ' ')
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
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=
]+$/i.test(text) && text.length <= 8_000_000) {
    return text.replace(/[
]/g, '');
  }
  return '';
}

function buildPromptFromRequest(body = {}) {
  const payload = body.payload || {};
  const directPrompt = cleanText(body.prompt || payload.prompt || '', 12000);
  if (directPrompt) return directPrompt;

  const driver = payload.driver?.name || body.driverName || 'selected current-grid driver';
  const team = payload.driver?.team || body.teamName || 'selected team';
  const template = payload.template?.title || body.templateTitle || 'PADDOX AI fan visual';
  const aspect = payload.output?.aspectLabel || payload.output?.aspectRatio || body.aspectRatio || '4:5';
  const fanName = payload.fan?.name || body.fanName || 'the fan';
  const tagline = payload.fan?.tagline || body.tagline || 'Create a premium motorsport fan visual';

  return [
    'PADDOX AI STUDIO REQUEST:',
    `Template: ${template}.`,
    `Driver: ${driver}.`,
    `Team: ${team}.`,
    `Output format: ${aspect}.`,
    '',
    `Create a premium realistic motorsport visual featuring ${fanName}.`,
    `Creative direction: ${tagline}.`,
    'Keep the look hyper-realistic, premium, and clean. Preserve natural skin texture, realistic lighting, coherent team colors, and believable motorsport styling.',
    'Avoid cartoonish rendering, extra fingers, duplicate faces, mismatched team colors, broken anatomy, messy sponsor text, low-detail skin, and blurred identity.'
  ].join('
');
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
    return successResponse(res, 200, 'AI Studio prompt built successfully.', {
      prompt,
      aiCredits: normalizeAiCredits(user.aiCredits),
      fanPoints: normalizeFanPoints(user.fanPoints),
      provider: 'prompt-builder-beta',
      providerMode: 'manual-external-generation',
      creditsUsed: 0,
      creditsDeducted: false,
      note: 'Live image generation is paused. Copy this prompt, generate in any external AI tool, then upload your result back to PADDOX to earn Fan Points.'
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
      note: 'Phase A4.11M: Prompt Builder Mode. External AI result upload rewards Fan Points. Live image generation will be reconnected later.'
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
