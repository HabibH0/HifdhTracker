// HTTP client for the Hifdh API. Pure (no Vite/DOM globals) so tests can drive it directly.

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
export class NetworkError extends Error {
  constructor(message = 'You’re offline.') { super(message); this.name = 'NetworkError'; }
}

export function createApi({ baseUrl, fetch: fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 30000 }) {
  const base = String(baseUrl ?? '').replace(/\/$/, '');
  async function request(method, path, { body, token } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (error) {
      throw new NetworkError(error?.name === 'AbortError' ? 'The server took too long to respond.' : undefined);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) throw new ApiError(res.status, data?.error ?? 'http_error', data?.message ?? `Request failed (${res.status}).`);
    return data;
  }
  return {
    enabled: !!base,
    register: (username, password) => request('POST', '/register', { body: { username, password } }),
    login: (username, password) => request('POST', '/login', { body: { username, password } }),
    logout: token => request('POST', '/logout', { token }),
    me: token => request('GET', '/me', { token }),
    sync: (token, payload) => request('POST', '/sync', { token, body: payload }),
    exportData: token => request('GET', '/export', { token }),
  };
}
