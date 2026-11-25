import { purgeLegacyLocalStorageTokens } from '../services/companyPreferenceService';

const SESSION_TOKEN_KEY = 'ledgerai_session_token';
let inMemoryToken: string | null = null;

// Immediately purge any legacy localStorage auth tokens on load (Security Mandate Section 7)
purgeLegacyLocalStorageTokens();

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    const stored = typeof window !== 'undefined' && window.sessionStorage
      ? window.sessionStorage.getItem(SESSION_TOKEN_KEY)
      : null;
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
    return null;
  } catch {
    return inMemoryToken;
  }
}

export function setAuthToken(token: string | null | undefined): void {
  inMemoryToken = token ? String(token) : null;
  purgeLegacyLocalStorageTokens();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (inMemoryToken) {
        window.sessionStorage.setItem(SESSION_TOKEN_KEY, inMemoryToken);
      } else {
        window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    }
  } catch (e) {
    console.error('Failed to save session auth token', e);
  }
}

export function clearAuthToken(): void {
  inMemoryToken = null;
  purgeLegacyLocalStorageTokens();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to clear session auth token', e);
  }
}

let interceptorInstalled = false;

function dispatchServerUnavailable(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('ledgerai:server-unavailable', { detail: { message } })
    );
  }
}

function dispatchServerAvailable() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ledgerai:server-available'));
  }
}

export function setupFetchInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined') return;

  const originalFetch = window.fetch;
  if (!originalFetch) return;

  const interceptedFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const urlString = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    let isApiCall = false;
    try {
      if (urlString) {
        if (urlString.startsWith('/api/')) {
          isApiCall = true;
        } else if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
          const parsedUrl = new URL(urlString);
          if (parsedUrl.origin === window.location.origin && parsedUrl.pathname.startsWith('/api/')) {
            isApiCall = true;
          }
        }
      }
    } catch (_) {}

    if (isApiCall) {
      init = init ? { ...init } : {};

      // Ensure credentials are sent (supports httpOnly session cookies on localhost and LAN HTTP/HTTPS)
      if (!init.credentials) {
        init.credentials = 'include';
      }

      // Automatically attach Authorization header if in-memory/session token exists
      const token = getAuthToken();
      const headers = new Headers(init.headers || {});
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      // Ensure POST/PUT/PATCH with JSON string or empty body has Content-Type: application/json (Express 5 body parsing)
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const ct = headers.get('Content-Type') || '';
        if (!init.body) {
          if (ct.includes('application/json') || !ct) {
            if (!ct) headers.set('Content-Type', 'application/json');
            init.body = '{}';
          }
        } else if (!ct && typeof init.body === 'string') {
          const trimmed = init.body.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            headers.set('Content-Type', 'application/json');
          }
        }
      }

      init.headers = headers;
    }

    const doFetch = async (retries = 3): Promise<Response> => {
      let res: Response;
      try {
        res = await originalFetch.call(window, input, init);
      } catch (networkErr: any) {
        if (isApiCall && networkErr?.name !== 'AbortError') {
          dispatchServerUnavailable(
            'Cannot reach the LedgerAI PH central server. Verify the server PC is online and connected to your local network.'
          );
        }
        throw networkErr;
      }

      if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
        const delay = res.status === 429
          ? Math.pow(2, 4 - retries) * 1000 + Math.random() * 500
          : (4 - retries) * 400;
        await new Promise(r => setTimeout(r, delay));
        return doFetch(retries - 1);
      }

      if (isApiCall) {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          dispatchServerUnavailable(
            `The LedgerAI PH central server returned HTTP ${res.status}. It may be restarting or temporarily offline.`
          );
        } else {
          dispatchServerAvailable();
        }
      }

      // Guard res.json() on all /api/ responses so HTML error pages ("<html><head>...") never throw "Unexpected token '<'"
      if (isApiCall && typeof res.json === 'function') {
        const origJson = res.json.bind(res);
        res.json = async () => {
          const clone = res.clone();
          try {
            return await origJson();
          } catch (_jsonErr) {
            const rawText = await clone.text().catch(() => '');
            const trimmed = (rawText || '').trim();

            // First check if rawText is actually valid JSON that was somehow locked or failed standard stream read
            if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
              try {
                return JSON.parse(trimmed);
              } catch (_) {}
            }

            if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<html')) {
              // Extract clean message from body, pre, p, or title tag
              const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              let rawMsg = '';
              if (bodyMatch && bodyMatch[1]) {
                rawMsg = bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              }
              if (!rawMsg) {
                const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
                rawMsg = titleMatch?.[1]?.trim() || '';
              }
              if (!rawMsg || rawMsg.toLowerCase().includes('ledger.ph')) {
                rawMsg = '';
              }

              const friendlyMessage = rawMsg || (res.status === 403
                ? 'Access denied: You do not have permission or role authority to perform this action.'
                : res.status >= 500
                ? `Server is temporarily busy or restarting (HTTP ${res.status}). Please try again.`
                : `Request could not be completed (HTTP ${res.status}).`);

              return {
                error: res.status === 403 ? 'FORBIDDEN' : 'SERVER_COMMUNICATION_ERROR',
                message: friendlyMessage,
              };
            }
            if (!trimmed) {
              return res.ok ? {} : { error: 'EMPTY_RESPONSE', message: `Request failed (HTTP ${res.status}).` };
            }
            return {
              error: 'INVALID_JSON_RESPONSE',
              message: trimmed.slice(0, 180),
            };
          }
        };
      }

      return res;
    };

    return doFetch();
  };

  try {
    window.fetch = interceptedFetch;
  } catch (e) {
    try {
      Object.defineProperty(window, 'fetch', {
        value: interceptedFetch,
        writable: true,
        configurable: true,
      });
    } catch (err) {
      console.warn('Could not override window.fetch directly:', err);
    }
  }

  // Globally patch Response.prototype.json as a secondary safety net
  if (typeof window !== 'undefined' && typeof window.Response !== 'undefined' && window.Response.prototype) {
    const proto = window.Response.prototype as any;
    if (!proto.__origJson) {
      proto.__origJson = proto.json;
      proto.json = async function() {
        const clone = this.clone();
        try {
          return await proto.__origJson.call(this);
        } catch (_err) {
          const raw = await clone.text().catch(() => '');
          const trimmed = (raw || '').trim();
          if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
            try { return JSON.parse(trimmed); } catch (_) {}
          }
          if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<html')) {
            return {
              error: 'HTML_RESPONSE_INTERCEPTED',
              message: this.status === 403
                ? 'Access denied: You do not have permission or role authority to perform this action.'
                : this.status >= 500
                ? `Server error (HTTP ${this.status}). Please try again.`
                : `Request could not be completed (HTTP ${this.status}).`
            };
          }
          return { error: 'INVALID_JSON_RESPONSE', message: trimmed.slice(0, 180) || `Empty response (HTTP ${this.status})` };
        }
      };
    }
  }

  interceptorInstalled = true;
};

// Initialize immediately upon module import
setupFetchInterceptor();

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const init: RequestInit = {
    credentials: 'include',
    ...options,
    headers: new Headers(options.headers || {})
  };

  const token = getAuthToken();
  const headers = init.headers as Headers;

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    init.body = JSON.stringify(init.body);
  } else if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    const trimmed = init.body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const res = await window.fetch(url, init);

  let data: any = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    const txt = await res.text().catch(() => '');
    try {
      data = JSON.parse(txt);
    } catch {
      data = txt.trim().startsWith('<')
        ? { error: 'SERVER_ERROR', message: `Request failed (HTTP ${res.status}). Please try again.` }
        : txt;
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ledgerai:unauthorized'));
      }
    }
    const errorMsg = (typeof data === 'object' && (data?.message || data?.error)) || `HTTP ${res.status}: ${res.statusText}`;
    const err: any = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}
