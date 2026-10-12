// Thin fetch wrapper. The session token lives in sessionStorage (cleared when the tab closes).
const KEY = 'fa_token';
export const getToken = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body, { raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload });
  } catch {
    throw new ApiError('Cannot reach the server. Please check your connection and try again.', 0);
  }
  if (raw) {
    if (!res.ok) throw new ApiError('Download failed', res.status);
    return res;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && token && !url.startsWith('/auth/login')) onUnauthorized(data?.error);
    throw new ApiError(data?.error || 'Something went wrong', res.status, data);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b = {}) => request('PUT', u, b),
  patch: (u, b = {}) => request('PATCH', u, b),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, formData) => request('POST', u, formData),
  async download(url, filename) {
    const res = await request('GET', url, undefined, { raw: true });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
