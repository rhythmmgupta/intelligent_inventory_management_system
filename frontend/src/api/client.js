const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const storage =
  typeof globalThis.localStorage !== 'undefined' &&
  typeof globalThis.localStorage.getItem === 'function'
    ? globalThis.localStorage
    : null;

let authToken = storage ? storage.getItem('fg_token') || '' : '';
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token || '';
  if (!storage) return;
  if (token) {
    storage.setItem('fg_token', token);
  } else {
    storage.removeItem('fg_token');
  }
}

export function getAuthToken() {
  return authToken;
}

export function registerUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (response.status === 401 && onUnauthorized && !path.startsWith('/auth/login')) {
    onUnauthorized();
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.details = data.details;
    throw err;
  }
  return data;
}
