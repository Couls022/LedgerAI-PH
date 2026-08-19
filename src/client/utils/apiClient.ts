const TOKEN_KEY = 'ledgerai_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

export function setAuthToken(token: string | null | undefined): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (e) {
    console.error('Failed to save auth token', e);
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    console.error('Failed to clear auth token', e);
  }
}

let interceptorInstalled = false;

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

      // Ensure credentials are sent
      if (!init.credentials) {
        init.credentials = 'include';
      }

      // Automatically attach Authorization header if token exists
      const token = getAuthToken();
      if (token) {
        const headers = new Headers(init.headers || {});
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        init.headers = headers;
      }
    }

    const doFetch = async (retries = 3): Promise<Response> => {
      const res = await originalFetch.call(window, input, init);
      if (res.status === 429 && retries > 0) {
        const delay = Math.pow(2, 4 - retries) * 1000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
        return doFetch(retries - 1);
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
  }

  const res = await window.fetch(url, init);

  let data: any = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthToken();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ledgerai:unauthorized'));
      }
    }
    const errorMsg = data?.message || data?.error || `HTTP ${res.status}: ${res.statusText}`;
    const err: any = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data as T;
}
