/* ============================================================
   FILE: controllers/aiStudio.controller.js
   PADDOX — AI Fan Studio Generation Foundation
   Phase A4.11C.6
   ============================================================ */
const User = require('../models/User');
const AiPoster = require('../models/AiPoster');
const { cloudinary } = require('../config/cloudinary');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const https = require('https');
const http = require('http');

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




/* A4.11C.6 Emergency generation speed fix:
   Do not fetch external logo URLs during generation. Render was hanging on remote
   asset fetch / image upload in some deploys. The poster now responds fast and
   uses PADDOX wordmark branding. A later phase can embed the real logo as a
   local/base64 asset without network calls. */
async function getPaddoxBrandIconDataUri() {
  return '';
}

function withTimeout(promise, ms = 6500, fallback = null) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
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

function safePhotoDataUri(value = '') {
  const text = String(value || '').trim();
  if (/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(text) && text.length < 1800000) {
    return text.replace(/[\r\n]/g, '');
  }
  return '';
}

function posterAccentFromTeam(teamMood = '') {
  const t = String(teamMood || '').toLowerCase();
  if (t.includes('ferrari')) return { primary:'#e8002d', secondary:'#c9a84c', glow:'#b00022', label:'FERRARI RED' };
  if (t.includes('red bull')) return { primary:'#244cff', secondary:'#f2c94c', glow:'#0b1740', label:'RACE BLUE' };
  if (t.includes('mclaren')) return { primary:'#ff8700', secondary:'#00a3e0', glow:'#391700', label:'PAPAYA SPEED' };
  if (t.includes('mercedes')) return { primary:'#00d2be', secondary:'#c8c8c8', glow:'#003a36', label:'SILVER ENERGY' };
  if (t.includes('aston')) return { primary:'#006f62', secondary:'#c9a84c', glow:'#002e29', label:'EMERALD GARAGE' };
  return { primary:'#e8002d', secondary:'#c9a84c', glow:'#51000f', label:'PADDOX RED' };
}

async function buildPlaceholderSvg({ fanName, style, driverInspiration, teamMood, outputFormat, creativePrompt, promptUsed, photoDataUrl }) {
  const { width, height, ratio } = formatToSize(outputFormat);
  const isWide = ratio === '16:9';
  const isSquare = ratio === '1:1';
  const accent = posterAccentFromTeam(teamMood);
  const displayName = cleanText(fanName || 'PADDOX FAN', 44).toUpperCase();
  const driverText = cleanText(driverInspiration || 'Driver-inspired', 52).toUpperCase();
  const styleText = cleanText(style || 'VIP Paddock', 42).toUpperCase();
  const teamText = cleanText(teamMood || accent.label, 36).toUpperCase();
  const promptText = cleanText(creativePrompt || 'Premium fictional motorsport fan artwork created for the PADDOX fan universe.', 160);
  const photo = safePhotoDataUri(photoDataUrl);

  const margin = isWide ? 54 : 58;
  const innerW = width - margin * 2;
  const innerH = height - margin * 2;
  const logoScale = isWide ? 0.82 : 1;
  const titleSize = isWide ? 76 : isSquare ? 68 : 82;
  const heroX = isWide ? width * 0.55 : width * 0.50;
  const heroY = isWide ? height * 0.50 : height * 0.42;
  const heroW = isWide ? width * 0.38 : width * 0.56;
  const heroH = isWide ? height * 0.56 : height * 0.46;
  const textX = isWide ? 78 : 76;
  const textY = isWide ? height * 0.42 : height * 0.58;
  const editionY = isWide ? height * 0.30 : height * 0.50;
  const footerY = height - 78;

  const escapedName = escapeSvg(displayName);
  const escapedStyle = escapeSvg(styleText);
  const escapedDriver = escapeSvg(driverText);
  const escapedTeam = escapeSvg(teamText);
  const escapedPrompt = escapeSvg(promptText);
  const primary = accent.primary;
  const secondary = accent.secondary;
  const glow = accent.glow;

  const photoLayer = photo ? `
    <g clip-path="url(#heroClip)">
      <rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" fill="#121212"/>
      <image href="${photo}" x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" preserveAspectRatio="xMidYMid slice" opacity=".72"/>
      <rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" fill="url(#heroShade)"/>
    </g>` : `
    <g clip-path="url(#heroClip)">
      <rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" fill="#121212"/>
      <rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" fill="url(#heroShade)"/>
      <circle cx="${heroX}" cy="${heroY-heroH*.12}" r="${Math.min(heroW,heroH)*.17}" fill="rgba(255,255,255,.16)"/>
      <path d="M${heroX-heroW*.20} ${heroY+heroH*.24} C${heroX-heroW*.13} ${heroY+heroH*.02} ${heroX+heroW*.13} ${heroY+heroH*.02} ${heroX+heroW*.20} ${heroY+heroH*.24} Z" fill="rgba(255,255,255,.13)"/>
      <text x="${heroX}" y="${heroY+heroH*.40}" text-anchor="middle" fill="rgba(255,255,255,.18)" font-family="Arial Black, Arial" font-size="${isWide?28:34}" letter-spacing="8">FAN HERO</text>
    </g>`;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#030303"/>
        <stop offset=".48" stop-color="#0b0b0b"/>
        <stop offset="1" stop-color="${glow}"/>
      </linearGradient>
      <radialGradient id="redGlow" cx="78%" cy="22%" r="62%">
        <stop offset="0" stop-color="${primary}" stop-opacity=".72"/>
        <stop offset=".42" stop-color="${primary}" stop-opacity=".22"/>
        <stop offset="1" stop-color="${primary}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="goldGlow" cx="20%" cy="73%" r="42%">
        <stop offset="0" stop-color="${secondary}" stop-opacity=".36"/>
        <stop offset="1" stop-color="${secondary}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="heroShade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity=".10"/>
        <stop offset=".52" stop-color="${primary}" stop-opacity=".18"/>
        <stop offset="1" stop-color="#000" stop-opacity=".70"/>
      </linearGradient>
      <clipPath id="heroClip"><rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" rx="30"/></clipPath>
      <filter id="soft"><feGaussianBlur stdDeviation="28"/></filter>
    </defs>

    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#redGlow)"/>
    <rect width="100%" height="100%" fill="url(#goldGlow)"/>

    <g opacity=".10">
      <path d="M0 ${height*.22} H${width}" stroke="#fff" stroke-width="1"/>
      <path d="M0 ${height*.38} H${width}" stroke="${primary}" stroke-width="3"/>
      <path d="M0 ${height*.62} H${width}" stroke="#fff" stroke-width="1"/>
      <path d="M${width*.10} -80 L${width*.60} ${height+120}" stroke="${primary}" stroke-width="2"/>
      <path d="M${width*.78} -80 L${width*.25} ${height+120}" stroke="#fff" stroke-width="1"/>
      <path d="M${width*.92} -20 L${width*.42} ${height+130}" stroke="${secondary}" stroke-width="1"/>
    </g>

    <g opacity=".16" filter="url(#soft)">
      <circle cx="${width*.82}" cy="${height*.25}" r="${Math.min(width,height)*.24}" fill="${primary}"/>
      <circle cx="${width*.22}" cy="${height*.72}" r="${Math.min(width,height)*.18}" fill="${secondary}"/>
    </g>

    <text x="${width*.50}" y="${height*.52}" text-anchor="middle" fill="rgba(255,255,255,.025)" font-family="Arial Black, Arial" font-size="${Math.min(width,height)*.22}" letter-spacing="10">PADDOX</text>

    <rect x="${margin}" y="${margin}" width="${innerW}" height="${innerH}" rx="38" fill="rgba(255,255,255,.018)" stroke="#ffffff" stroke-opacity=".13"/>
    <rect x="${margin+16}" y="${margin+16}" width="${innerW-32}" height="${innerH-32}" rx="30" fill="none" stroke="${primary}" stroke-opacity=".32"/>

    <g transform="translate(${textX},${isWide ? 70 : 82}) scale(${logoScale})">
      <rect x="0" y="0" width="370" height="92" rx="24" fill="rgba(7,7,7,.44)" stroke="#fff" stroke-opacity=".08"/>
      <text x="22" y="42" fill="#fff" font-family="Arial Black, Arial" font-size="36" letter-spacing="8">PADDO<tspan fill="${primary}">X</tspan></text>
      <text x="25" y="68" fill="#aaa" font-family="Arial" font-size="13" letter-spacing="5">AI FAN STUDIO</text>
      <text x="25" y="86" fill="${secondary}" font-family="Arial Black, Arial" font-size="9" letter-spacing="3">A4.11C.6 FAST GENERATION</text>
    </g>

    ${photoLayer}
    <rect x="${heroX-heroW/2}" y="${heroY-heroH/2}" width="${heroW}" height="${heroH}" rx="30" fill="none" stroke="${secondary}" stroke-opacity=".34" stroke-width="2"/>
    <path d="M${heroX-heroW*.46} ${heroY-heroH*.38} H${heroX+heroW*.46}" stroke="${primary}" stroke-opacity=".45" stroke-width="2"/>
    <path d="M${heroX-heroW*.46} ${heroY+heroH*.38} H${heroX+heroW*.46}" stroke="#fff" stroke-opacity=".16" stroke-width="1"/>

    <text x="${textX}" y="${editionY}" fill="${secondary}" font-family="Arial Black, Arial" font-size="${isWide?18:20}" letter-spacing="6">${escapedStyle} EDITION · ${escapedTeam}</text>
    <text x="${textX}" y="${textY}" fill="#fff" font-family="Arial Black, Arial" font-size="${titleSize}" letter-spacing="4">${escapedName}</text>
    <text x="${textX+4}" y="${textY+54}" fill="${primary}" font-family="Arial Black, Arial" font-size="${isWide?25:30}" letter-spacing="4">${escapedDriver}</text>
    <foreignObject x="${textX+4}" y="${textY+78}" width="${isWide ? width*.44 : width*.55}" height="130">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#dadada;font-size:${isWide?20:23}px;line-height:1.32;letter-spacing:.4px;">${escapedPrompt}</div>
    </foreignObject>

    <g transform="translate(${width-355},${height-238})">
      <rect width="252" height="126" rx="24" fill="#060606" fill-opacity=".76" stroke="#ffffff" stroke-opacity=".13"/>
      <text x="32" y="46" fill="#999" font-family="Arial" font-size="14" letter-spacing="4">FICTIONAL</text>
      <text x="32" y="86" fill="#fff" font-family="Arial Black, Arial" font-size="30" letter-spacing="3">FAN ART</text>
      <path d="M174 29h40l-12 17h-42z" fill="${primary}" opacity=".85"/>
    </g>

    <text x="${margin+26}" y="${footerY}" fill="#858585" font-family="Arial" font-size="16" letter-spacing="4">GENERATED BY PADDOX · NOT OFFICIAL DRIVER ENDORSEMENT · A4.11C.6</text>
    <text x="${width-margin-26}" y="${footerY}" fill="${primary}" font-family="Arial Black, Arial" font-size="21" text-anchor="end" letter-spacing="3">15 CREDITS</text>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function uploadDataUriToCloudinary(dataUri, userId) {
  if (!cloudinary) return { url: dataUri, publicId: '', cloudinarySaved: false };

  try {
    const result = await withTimeout(cloudinary.uploader.upload(dataUri, {
      folder: `paddox/ai-posters/${userId}`,
      resource_type: 'image',
      overwrite: false,
      unique_filename: true,
      use_filename: false,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    }), 6500, null);

    if (!result) {
      console.warn('PADDOX AI poster Cloudinary save timed out. Returning data URI fallback.');
      return { url: dataUri, publicId: '', cloudinarySaved: false, timeout: true };
    }

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
    const submittedFanName = cleanText(body.fanName || '', 60);
    const profileFanName = cleanText(`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')?.[0] || 'PADDOX FAN', 60);
    const fanName = (!submittedFanName || submittedFanName.toLowerCase() === 'paddox fan' || submittedFanName.toLowerCase() === 'your display name')
      ? profileFanName
      : submittedFanName;
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

    const dataUri = await buildPlaceholderSvg({ fanName, style, driverInspiration, teamMood, outputFormat, creativePrompt, promptUsed, photoDataUrl: body.photoDataUrl });
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
        note: 'A4.11C.6 fast fallback: no remote logo fetch; Cloudinary save has timeout to prevent hanging.'
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
