/* ============================================================
   FILE: middleware/csrf.middleware.js
   PADDOX — CSRF Double-Submit Cookie Protection
   Phase 7 — Step 3g

   Strategy: Double-Submit Cookie pattern (stateless).
   - On GET /api/auth/csrf-token: generate a cryptographically random
     token, set it as a SameSite cookie, and return it in the body.
   - On state-changing requests (POST/PUT/PATCH/DELETE): require the
     token in the X-CSRF-Token header and validate it matches the cookie.
   - The authentication session cookie (accessToken) is HttpOnly and
     cannot be read by JS, so it cannot be used as the CSRF proof.
     A separate non-HttpOnly CSRF token cookie is used for the double-submit.

   Exclusions:
   - GET/HEAD/OPTIONS are exempt (no state change)
   - /api/auth/login and /api/auth/register are exempt (pre-session)
   - /api/auth/refresh is exempt (cookie-only, no body)
   - /api/auth/google is exempt (pre-session)
   - /api/auth/csrf-token is the issuing endpoint itself

   IMPORTANT: The CSRF token cookie must NOT be HttpOnly so the
   frontend JS can read and attach it to the X-CSRF-Token header.
   The authentication cookies REMAIN HttpOnly.
   ============================================================ */
'use strict';

const { randomBytes, timingSafeEqual } = require('crypto');

const CSRF_COOKIE = 'paddox_csrf_token';
const CSRF_HEADER = 'x-csrf-token';
const TOKEN_BYTES = 32;

/* Routes exempt from CSRF validation */
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/google',
  '/api/auth/csrf-token',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Generate and issue a new CSRF token.
 * Called by GET /api/auth/csrf-token.
 */
const issueCsrfToken = (req, res) => {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,       // Must be readable by frontend JS
    secure  : isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge  : 60 * 60 * 1000, // 1 hour
    path    : '/',
  });

  return res.status(200).json({
    success: true,
    message: 'CSRF token issued',
    // Return token in body as well so the frontend can cache it
    // without re-reading the cookie (useful for SPA-like navigation)
    csrfToken: token,
  });
};

/**
 * CSRF validation middleware.
 * Applied globally after cookie parsing; exemptions checked inline.
 */
const validateCsrf = (req, res, next) => {
  // Safe methods do not change state
  if (SAFE_METHODS.has(req.method)) return next();

  // Check for exempted paths (exact match on pathname)
  const pathname = req.path;
  if (CSRF_EXEMPT_PATHS.has(pathname)) return next();
  // Support parameterised reset-password path
  if (pathname.startsWith('/api/auth/reset-password')) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers?.[CSRF_HEADER];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      success    : false,
      error_code : 'csrf_token_missing',
      message    : 'CSRF token missing. Fetch a token from /api/auth/csrf-token.',
    });
  }

  try {
    const a = Buffer.from(cookieToken, 'utf8');
    const b = Buffer.from(headerToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(403).json({
        success    : false,
        error_code : 'csrf_token_invalid',
        message    : 'CSRF token mismatch.',
      });
    }
  } catch {
    return res.status(403).json({
      success    : false,
      error_code : 'csrf_token_invalid',
      message    : 'CSRF validation failed.',
    });
  }

  next();
};

module.exports = { validateCsrf, issueCsrfToken, CSRF_COOKIE, CSRF_HEADER };
