import { getAuthToken, setupFetchInterceptor } from './apiClient';

// Ensure global fetch interceptor is active
setupFetchInterceptor();

/**
 * Authenticated fetch wrapper returning a standard Fetch API Response
 * while automatically attaching Bearer token and credentials.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    const trimmed = init.body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  return window.fetch(input, {
    credentials: 'include',
    ...init,
    headers,
  });
}
