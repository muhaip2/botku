// src/utils.js
export function runBg(ctx, promise) {
  try {
    ctx.waitUntil(Promise.resolve(promise).catch(() => {}));
  } catch (_) { /* noop */ }
}
