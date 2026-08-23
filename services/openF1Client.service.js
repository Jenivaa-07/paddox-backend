const axios = require('axios');

const API_BASE = String(process.env.OPENF1_BASE_URL || 'https://api.openf1.org/v1').replace(/\/$/, '');
const TOKEN_URL = 'https://api.openf1.org/token';

let cachedToken = '';
let cachedTokenExpiresAt = 0;
let tokenPromise = null;

function legacyStaticToken() {
  return String(process.env.OPENF1_ACCESS_TOKEN || process.env.OPENF1_API_KEY || '').trim();
}

function hasOAuthCredentials() {
  return Boolean(String(process.env.OPENF1_USERNAME || '').trim() && String(process.env.OPENF1_PASSWORD || '').trim());
}

async function fetchOAuthToken(force = false) {
  const now = Date.now();
  if (!force && cachedToken && cachedTokenExpiresAt - 60000 > now) return cachedToken;

  const staticToken = legacyStaticToken();
  if (!hasOAuthCredentials()) return staticToken;
  if (tokenPromise && !force) return tokenPromise;

  tokenPromise = (async () => {
    const form = new URLSearchParams();
    form.set('username', String(process.env.OPENF1_USERNAME || '').trim());
    form.set('password', String(process.env.OPENF1_PASSWORD || '').trim());

    const response = await axios.post(TOKEN_URL, form.toString(), {
      timeout: 12000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'PADDOX/1.0'
      }
    });

    const token = String(response.data?.access_token || '').trim();
    if (!token) throw new Error('OpenF1 token response did not include an access_token');
    const expiresIn = Math.max(300, Number(response.data?.expires_in || 3600));
    cachedToken = token;
    cachedTokenExpiresAt = Date.now() + expiresIn * 1000;
    return token;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

function normalizedError(error, endpoint) {
  const status = Number(error?.response?.status || 0);
  const upstream = error?.response?.data;
  const message = typeof upstream === 'string'
    ? upstream
    : upstream?.detail || upstream?.message || error?.message || 'OpenF1 request failed';

  const wrapped = new Error(String(message));
  wrapped.status = status || 502;
  wrapped.code = status === 401
    ? 'OPENF1_AUTH_REQUIRED'
    : status === 429
      ? 'OPENF1_RATE_LIMITED'
      : 'OPENF1_UPSTREAM_ERROR';
  wrapped.endpoint = endpoint;
  wrapped.retryAfter = error?.response?.headers?.['retry-after'] || null;
  return wrapped;
}

async function rawRequest(endpoint, params = {}, token = '') {
  const headers = {
    'Accept': 'application/json',
    'User-Agent': 'PADDOX/1.0'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return axios.get(`${API_BASE}/${String(endpoint).replace(/^\//, '')}`, {
    params,
    timeout: 20000,
    headers,
    validateStatus: status => status >= 200 && status < 400
  });
}

async function openF1Request(endpoint, params = {}, options = {}) {
  const requireAuth = Boolean(options.requireAuth);
  const preferAuth = Boolean(options.preferAuth);
  const staticToken = legacyStaticToken();
  const canAuthenticate = Boolean(staticToken || hasOAuthCredentials());

  if (!requireAuth && !preferAuth) {
    try {
      return await rawRequest(endpoint, params, '');
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status !== 401 || !canAuthenticate) throw normalizedError(error, endpoint);
    }
  }

  if (!canAuthenticate) {
    const err = new Error('OpenF1 currently requires authentication. Historical public access can also be temporarily restricted while a live F1 session is running.');
    err.status = 503;
    err.code = 'OPENF1_AUTH_REQUIRED';
    err.endpoint = endpoint;
    throw err;
  }

  let token = await fetchOAuthToken(false);
  try {
    return await rawRequest(endpoint, params, token);
  } catch (error) {
    if (Number(error?.response?.status || 0) === 401 && hasOAuthCredentials()) {
      token = await fetchOAuthToken(true);
      try {
        return await rawRequest(endpoint, params, token);
      } catch (retryError) {
        throw normalizedError(retryError, endpoint);
      }
    }
    throw normalizedError(error, endpoint);
  }
}

function openF1Status() {
  return {
    baseUrl: API_BASE,
    authenticatedModeConfigured: Boolean(legacyStaticToken() || hasOAuthCredentials()),
    oauthRefreshConfigured: hasOAuthCredentials(),
    tokenCached: Boolean(cachedToken && cachedTokenExpiresAt > Date.now())
  };
}

module.exports = {
  openF1Request,
  openF1Status,
  fetchOAuthToken
};