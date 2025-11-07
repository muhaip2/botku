// src/utils.js
// Util umum untuk performa & reliabilitas

// fetch dengan timeout agar request tidak ngegantung
export async function fetchWithTimeout(url, opts = {}, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// jalankan promise di background tanpa menjegal response 200 OK
export const runBg = (ctx, p) => {
  try {
    ctx.waitUntil(Promise.resolve(p));
  } catch { /* noop */ }
};
