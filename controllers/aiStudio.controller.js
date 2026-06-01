/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Generation Foundation
   Phase A4.11C
   ============================================================ */
const User = require('../models/User');
const AiPoster = require('../models/AiPoster');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse } = require('../utils/apiResponse');

const STANDARD_AI_POSTER_COST = 15;

function serverError(res, err, label = 'AI Studio server error') {
  console.error(label, err);
  return res.status(500).json({ success:false, message: err.message || label });
}

function cleanText(value = '', max = 160) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeAiCredits(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 50;
}

function escapeSvg(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatToSize(format = '') {
  const f = String(format || '').toLowerCase();
  if (f.includes('square')) return { width: 1200, height: 1200, ratio: '1:1' };
  if (f.includes('wallpaper')) return { width: 1600, height: 900, ratio: '16:9' };
  return { width: 1080, height: 1350, ratio: '4:5' };
}

function buildSafePrompt(body = {}) {
  const style = cleanText(body.style || 'VIP Paddock', 80);
  const tone = cleanText(body.tone || '', 180);
  const fanName = cleanText(body.fanName || 'PADDOX FAN', 60);
  const driver = cleanText(body.driverInspiration || 'favorite motorsport driver inspiration', 80);
  const teamMood = cleanText(body.teamMood || 'PADDOX Red', 80);
  const format = cleanText(body.outputFormat || 'Portrait 4:5', 40);
  const creativePrompt = cleanText(body.creativePrompt || '', 420);

  return [
    `Create a fictional premium motorsport fan poster for PADDOX.`,
    `Fan display name: ${fanName}.`,
    `Style: ${style}.`,
    tone ? `Visual tone: ${tone}.` : '',
    `Driver inspiration: ${driver}. Do not imply a real endorsement or real photographed meeting.`,
    `Team color mood: ${teamMood}.`,
    `Output format: ${format}.`,
    creativePrompt ? `Creative direction: ${creativePrompt}.` : '',
    `Use luxury black graphite, white contrast, red racing accents, speed lines, glass depth, clean branding, cinematic lighting.`,
    `This is fictional fan artwork only.`
  ].filter(Boolean).join(' ');
}

function buildPlaceholderSvg({ fanName, style, driverInspiration, teamMood, outputFormat, creativePrompt, promptUsed }) {
  const { width, height, ratio } = formatToSize(outputFormat);
  const isWide = ratio === '16:9';
  const titleSize = isWide ? 92 : 88;
  const styleY = isWide ? 260 : 410;
  const nameY = isWide ? 385 : 560;
  const noteY = isWide ? 475 : 685;
  const footerY = height - 82;
  const escapedName = escapeSvg(String(fanName || 'PADDOX FAN').toUpperCase());
  const escapedStyle = escapeSvg(style || 'VIP Paddock');
  const escapedDriver = escapeSvg(driverInspiration || 'Driver-inspired');
  const escapedTeam = escapeSvg(teamMood || 'PADDOX Red');
  const escapedPrompt = escapeSvg(creativePrompt || 'Fictional motorsport fan artwork');

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#050505"/>
        <stop offset=".48" stop-color="#101010"/>
        <stop offset="1" stop-color="#260008"/>
      </linearGradient>
      <radialGradient id="redGlow" cx="72%" cy="22%" r="60%">
        <stop offset="0" stop-color="#e8002d" stop-opacity=".55"/>
        <stop offset=".45" stop-color="#e8002d" stop-opacity=".14"/>
        <stop offset="1" stop-color="#e8002d" stop-opacity="0"/>
      </radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="24"/></filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#redGlow)"/>
    <g opacity=".16">
      <path d="M-100 ${height*.22} H${width+200}" stroke="#ffffff" stroke-width="1"/>
      <path d="M-120 ${height*.36} H${width+200}" stroke="#e8002d" stroke-width="3"/>
      <path d="M-80 ${height*.62} H${width+120}" stroke="#ffffff" stroke-width="1"/>
      <path d="M${width*.12} -60 L${width*.62} ${height+90}" stroke="#e8002d" stroke-width="2"/>
      <path d="M${width*.72} -60 L${width*.22} ${height+90}" stroke="#ffffff" stroke-width="1"/>
    </g>
    <g opacity=".22" filter="url(#blur)">
      <circle cx="${width*.78}" cy="${height*.28}" r="${Math.min(width,height)*.24}" fill="#e8002d"/>
      <circle cx="${width*.28}" cy="${height*.70}" r="${Math.min(width,height)*.18}" fill="#c9a84c"/>
    </g>
    <rect x="42" y="42" width="${width-84}" height="${height-84}" rx="36" fill="none" stroke="#ffffff" stroke-opacity=".14"/>
    <rect x="58" y="58" width="${width-116}" height="${height-116}" rx="30" fill="none" stroke="#e8002d" stroke-opacity=".28"/>
    <g transform="translate(${isWide ? 74 : 70},${isWide ? 86 : 92})">
      <circle cx="42" cy="42" r="42" fill="#0b0b0b" stroke="#e8002d" stroke-opacity=".7" stroke-width="3"/>
      <path d="M22 45c7-18 24-27 43-17 8 4 14 11 17 20H59c-6 0-10 3-12 9H25c-5 0-7-5-3-12z" fill="#f5f5f5" opacity=".92"/>
      <path d="M43 30h31l-9 13H37z" fill="#e8002d" opacity=".96"/>
      <path d="M30 60h35l-8 8H27z" fill="#e8002d" opacity=".78"/>
      <text x="104" y="35" fill="#fff" font-family="Arial Black, Arial" font-size="34" letter-spacing="5">PADDO<tspan fill="#e8002d">X</tspan></text>
      <text x="106" y="64" fill="#999" font-family="Arial" font-size="14" letter-spacing="4">AI FAN STUDIO</text>
    </g>
    <text x="${isWide ? 76 : 70}" y="${styleY}" fill="#c9a84c" font-family="Arial, sans-serif" font-size="24" letter-spacing="6">${escapedStyle.toUpperCase()} · ${escapedTeam.toUpperCase()}</text>
    <text x="${isWide ? 76 : 70}" y="${nameY}" fill="#fff" font-family="Arial Black, Arial" font-size="${titleSize}" letter-spacing="4">${escapedName}</text>
    <text x="${isWide ? 80 : 74}" y="${noteY}" fill="#e8002d" font-family="Arial Black, Arial" font-size="32" letter-spacing="3">${escapedDriver.toUpperCase()}</text>
    <foreignObject x="${isWide ? 78 : 74}" y="${noteY+36}" width="${isWide ? width*.48 : width-148}" height="150">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#d7d7d7;font-size:25px;line-height:1.35;letter-spacing:.5px;">${escapedPrompt}</div>
    </foreignObject>
    <g opacity=".9">
      <rect x="${width-370}" y="${height-240}" width="260" height="124" rx="24" fill="#090909" fill-opacity=".74" stroke="#ffffff" stroke-opacity=".12"/>
      <text x="${width-338}" y="${height-190}" fill="#999" font-family="Arial" font-size="15" letter-spacing="3">FICTIONAL</text>
      <text x="${width-338}" y="${height-150}" fill="#fff" font-family="Arial Black, Arial" font-size="29" letter-spacing="2">FAN ART</text>
    </g>
    <text x="70" y="${footerY}" fill="#777" font-family="Arial" font-size="17" letter-spacing="4">GENERATED BY PADDOX · NOT OFFICIAL DRIVER ENDORSEMENT</text>
    <text x="${width-70}" y="${footerY}" fill="#e8002d" font-family="Arial Black, Arial" font-size="20" text-anchor="end" letter-spacing="3">15 CREDITS</text>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function uploadDataUriToCloudinary(dataUri, userId) {
  if (!cloudinary) return { url: dataUri, publicId: '', cloudinarySaved: false };

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `paddox/ai-posters/${userId}`,
      resource_type: 'image',
      overwrite: false,
      unique_filename: true,
      use_filename: false,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    });

    return {
      url: result.secure_url || result.url || dataUri,
      publicId: result.public_id || '',
      cloudinarySaved: true,
      width: result.width || 0,
      height: result.height || 0
    };
  } catch (err) {
    console.warn('PADDOX AI poster Cloudinary save failed. Returning safe data URI fallback:', err.message);
    return { url: dataUri, publicId: '', cloudinarySaved: false };
  }
}

exports.generatePoster = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return errorResponse(res, 404, 'User not found');

    const before = normalizeAiCredits(user.aiCredits);
    if (before < STANDARD_AI_POSTER_COST) {
      return res.status(402).json({
        success: false,
        message: `Not enough PADDOX Credits. You need ${STANDARD_AI_POSTER_COST} credits.`,
        data: { aiCredits: before, required: STANDARD_AI_POSTER_COST }
      });
    }

    const body = req.body || {};
    const style = cleanText(body.style || 'VIP Paddock', 80);
    const tone = cleanText(body.tone || '', 180);
    const fanName = cleanText(body.fanName || `${user.firstName || 'PADDOX'} ${user.lastName || 'FAN'}`, 60);
    const driverInspiration = cleanText(body.driverInspiration || 'Driver-inspired', 80);
    const teamMood = cleanText(body.teamMood || 'PADDOX Red', 80);
    const outputFormat = cleanText(body.outputFormat || 'Portrait 4:5', 40);
    const creativePrompt = cleanText(body.creativePrompt || '', 420);
    const promptUsed = buildSafePrompt({ style, tone, fanName, driverInspiration, teamMood, outputFormat, creativePrompt });

    /* Gemini-ready switch: real provider can be connected in A4.11C.2 by using
       GEMINI_API_KEY + AI_STUDIO_MODE=live. This foundation keeps the app safe
       today by producing a branded PADDOX preview poster and saving it. */
    const provider = process.env.AI_IMAGE_PROVIDER || 'paddox-preview';
    const providerMode = process.env.AI_STUDIO_MODE === 'live' && process.env.GEMINI_API_KEY
      ? 'gemini-ready-fallback'
      : 'preview';

    const dataUri = buildPlaceholderSvg({ fanName, style, driverInspiration, teamMood, outputFormat, creativePrompt, promptUsed });
    const uploaded = await uploadDataUriToCloudinary(dataUri, user._id.toString());

    user.aiCredits = Math.max(0, before - STANDARD_AI_POSTER_COST);
    await user.save({ validateBeforeSave:false });

    const poster = await AiPoster.create({
      user: user._id,
      fanName,
      style,
      tone,
      driverInspiration,
      teamMood,
      outputFormat,
      creativePrompt,
      promptUsed,
      provider,
      providerMode,
      cost: STANDARD_AI_POSTER_COST,
      creditsBefore: before,
      creditsAfter: user.aiCredits,
      image: uploaded,
      status: 'generated',
      meta: {
        hasUserPhoto: !!body.photoDataUrl,
        realProviderEnabled: providerMode !== 'preview',
        note: 'A4.11C foundation generates safe branded poster placeholder. A4.11C.2 can connect live Gemini image API.'
      }
    });

    return successResponse(res, 201, 'AI poster generated. 15 credits used.', {
      poster,
      aiCredits: user.aiCredits,
      cost: STANDARD_AI_POSTER_COST,
      provider,
      providerMode
    });
  } catch (err) {
    return serverError(res, err, 'AI poster generation failed');
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
