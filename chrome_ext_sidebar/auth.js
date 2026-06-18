/**
 * ThoughtForm – Authentication Module
 *
 * 2-tier Google OAuth via chrome.identity.launchWebAuthFlow():
 *   Tier 1: openid, email, profile  → user identity + per-user data
 *   Tier 2: calendar.readonly, drive.readonly → meeting picker + doc context
 *
 * Tokens are stored in chrome.storage.local and validated before each use.
 */

// ─── Configuration ───

const OAUTH_CLIENT_ID = '478784405636-jrcu1n71u2eg0ga6flagpluq4r5jdelf.apps.googleusercontent.com';

const REQUIRED_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

// Deprecated separate tiers, unified under REQUIRED_SCOPES
const TIER1_SCOPES = REQUIRED_SCOPES;
const TIER2_SCOPES = [];

const STORAGE_KEYS = {
  user: 'tf_user',
  accessToken: 'tf_access_token',
  tokenExpiry: 'tf_token_expiry',
  grantedScopes: 'tf_granted_scopes',
};

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ─── State ───

let _cachedUser = null;
let _cachedToken = null;
let _cachedExpiry = 0;
let _cachedScopes = [];
let _authChangeListeners = [];

// ─── Public API ───

const auth = {
  /**
   * Initialize auth state from storage. Call once on extension startup.
   * @returns {Promise<object|null>} The user object or null.
   */
  async init() {
    const data = await chromeStorageGet([
      STORAGE_KEYS.user,
      STORAGE_KEYS.accessToken,
      STORAGE_KEYS.tokenExpiry,
      STORAGE_KEYS.grantedScopes,
    ]);

    _cachedUser = data[STORAGE_KEYS.user] || null;
    _cachedToken = data[STORAGE_KEYS.accessToken] || null;
    _cachedExpiry = data[STORAGE_KEYS.tokenExpiry] || 0;
    _cachedScopes = data[STORAGE_KEYS.grantedScopes] || [];

    return _cachedUser;
  },

  /**
   * Sign in with Google (Tier 1 — basic identity).
   * Opens a popup with Google's consent screen.
   * @returns {Promise<object>} The user object { uid, email, name, photoUrl }.
   */
  async signIn() {
    const result = await launchOAuth(TIER1_SCOPES);
    const user = await fetchUserProfile(result.accessToken);

    // Persist
    _cachedUser = user;
    _cachedToken = result.accessToken;
    _cachedExpiry = result.expiry;
    _cachedScopes = result.scopes;

    await chromeStorageSet({
      [STORAGE_KEYS.user]: user,
      [STORAGE_KEYS.accessToken]: result.accessToken,
      [STORAGE_KEYS.tokenExpiry]: result.expiry,
      [STORAGE_KEYS.grantedScopes]: result.scopes,
    });

    notifyAuthChange(user);
    console.log('TF Auth: Signed in as', user.email);
    return user;
  },

  /**
   * Connect Calendar & Drive (Tier 2 — incremental consent).
   * Requests additional scopes without re-prompting for basic scopes.
   * @returns {Promise<object>} Updated user object.
   */
  async connectServices() {
    const allScopes = [...TIER1_SCOPES, ...TIER2_SCOPES];
    const result = await launchOAuth(allScopes);

    // Re-fetch profile (token may differ)
    const user = await fetchUserProfile(result.accessToken);

    _cachedUser = user;
    _cachedToken = result.accessToken;
    _cachedExpiry = result.expiry;
    _cachedScopes = result.scopes;

    await chromeStorageSet({
      [STORAGE_KEYS.user]: user,
      [STORAGE_KEYS.accessToken]: result.accessToken,
      [STORAGE_KEYS.tokenExpiry]: result.expiry,
      [STORAGE_KEYS.grantedScopes]: result.scopes,
    });

    notifyAuthChange(user);
    console.log('TF Auth: Calendar & Drive connected. Scopes:', result.scopes);
    return user;
  },

  /**
   * Sign out — clear all tokens and user data.
   */
  async signOut() {
    // Revoke the token with Google
    if (_cachedToken) {
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${_cachedToken}`);
      } catch (e) {
        console.warn('TF Auth: Token revocation failed (non-critical):', e.message);
      }
    }

    _cachedUser = null;
    _cachedToken = null;
    _cachedExpiry = 0;
    _cachedScopes = [];

    await chromeStorageRemove(Object.values(STORAGE_KEYS));
    notifyAuthChange(null);
    console.log('TF Auth: Signed out');
  },

  /**
   * Get the current user object.
   * @returns {object|null} { uid, email, name, photoUrl } or null.
   */
  getUser() {
    return _cachedUser;
  },

  /**
   * Get a valid access token, refreshing silently if expired.
   * @returns {Promise<string|null>} The access token or null if not signed in.
   */
  async getToken() {
    if (!_cachedToken) return null;

    // Check if token is expired (with 60s buffer)
    if (Date.now() > _cachedExpiry - 60_000) {
      console.log('TF Auth: Token expired, re-authenticating silently...');
      try {
        // Attempt silent re-auth (non-interactive if session exists)
        const scopes = _cachedScopes.length > 0 ? _cachedScopes : TIER1_SCOPES;
        const scopeList = typeof scopes === 'string' ? scopes.split(' ') : scopes;
        const result = await launchOAuth(scopeList, false); // interactive = false
        const user = await fetchUserProfile(result.accessToken);

        _cachedUser = user;
        _cachedToken = result.accessToken;
        _cachedExpiry = result.expiry;
        _cachedScopes = result.scopes;

        await chromeStorageSet({
          [STORAGE_KEYS.user]: user,
          [STORAGE_KEYS.accessToken]: result.accessToken,
          [STORAGE_KEYS.tokenExpiry]: result.expiry,
          [STORAGE_KEYS.grantedScopes]: result.scopes,
        });

        return _cachedToken;
      } catch (e) {
        console.warn('TF Auth: Silent re-auth failed, signing out. Reason:', e.message);
        // Clear all stored credentials and expire session
        await auth.signOut();
        // If in iframe/sidebar frame context, notify parent window to redirect to login
        if (typeof window !== 'undefined' && window.parent !== window) {
          window.parent.postMessage({ type: 'SESSION_EXPIRED' }, '*');
        }
        return null;
      }
    }

    return _cachedToken;
  },

  /**
   * @returns {boolean} Whether the user is signed in (has a cached user object).
   */
  isSignedIn() {
    return _cachedUser !== null;
  },

  /**
   * @returns {boolean} Whether Calendar scope has been granted.
   */
  hasCalendarAccess() {
    if (!_cachedScopes || _cachedScopes.length === 0) return false;
    const joined = Array.isArray(_cachedScopes) ? _cachedScopes.join(' ') : _cachedScopes;
    return joined.includes('calendar');
  },

  /**
   * @returns {boolean} Whether Drive scope has been granted.
   */
  hasDriveAccess() {
    if (!_cachedScopes || _cachedScopes.length === 0) return false;
    const joined = Array.isArray(_cachedScopes) ? _cachedScopes.join(' ') : _cachedScopes;
    return joined.includes('drive');
  },

  /**
   * @returns {boolean} Whether both Calendar and Drive scopes are granted.
   */
  hasEnhancedAccess() {
    return this.hasCalendarAccess() && this.hasDriveAccess();
  },

  /**
   * Register a callback for auth state changes.
   * @param {Function} cb — Called with (user) when auth state changes.
   * @returns {Function} Unsubscribe function.
   */
  onAuthChange(cb) {
    _authChangeListeners.push(cb);
    return () => {
      _authChangeListeners = _authChangeListeners.filter(l => l !== cb);
    };
  },
};

// ─── Internal Helpers ───

/**
 * Launch Google OAuth flow via chrome.identity.launchWebAuthFlow.
 * Uses implicit flow (response_type=token) for simplicity.
 * @param {string[]} scopes — OAuth scopes to request.
 * @param {boolean} interactive — Whether to prompt the user.
 * @returns {Promise<{ accessToken: string, expiry: number, scopes: string[] }>}
 */
function launchOAuth(scopes, interactive = true) {
  return new Promise((resolve, reject) => {
    const redirectUri = chrome.identity.getRedirectURL();
    const scopeStr = scopes.join(' ');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', scopeStr);
    authUrl.searchParams.set('include_granted_scopes', 'true');
    if (interactive) {
      authUrl.searchParams.set('prompt', 'consent');
    } else {
      authUrl.searchParams.set('prompt', 'none');
    }

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!responseUrl) {
          reject(new Error('No response URL from auth flow'));
          return;
        }

        // Parse the fragment (implicit flow returns token in hash)
        const params = new URLSearchParams(responseUrl.split('#')[1]);
        const accessToken = params.get('access_token');
        const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
        const returnedScopes = (params.get('scope') || scopeStr).split(' ');

        if (!accessToken) {
          reject(new Error('No access token in response'));
          return;
        }

        resolve({
          accessToken,
          expiry: Date.now() + expiresIn * 1000,
          scopes: returnedScopes,
        });
      }
    );
  });
}

/**
 * Fetch the user's Google profile from the userinfo endpoint.
 * @param {string} accessToken
 * @returns {Promise<{ uid: string, email: string, name: string, photoUrl: string }>}
 */
async function fetchUserProfile(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch user profile: ${res.status}`);
  }

  const data = await res.json();
  return {
    uid: data.sub,
    email: data.email,
    name: data.name || data.email.split('@')[0],
    photoUrl: data.picture || '',
  };
}

/**
 * Notify all registered auth change listeners.
 * @param {object|null} user
 */
function notifyAuthChange(user) {
  _authChangeListeners.forEach(cb => {
    try { cb(user); } catch (e) { console.error('TF Auth: Listener error:', e); }
  });
}

// ─── Chrome Storage Wrappers ───

function chromeStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result));
  });
}

function chromeStorageSet(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => resolve());
  });
}

function chromeStorageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

// Export for other extension scripts
if (typeof window !== 'undefined') {
  window.auth = auth;
}
