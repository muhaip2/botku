/**
 * Bangun object konfigurasi dari ENV Pages.
 * Pastikan semua optional punya default aman.
 */
export function buildSettings(env) {
  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    ADMIN_IDS: (env.ADMIN_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || '',
    WATERMARK_POSITION: env.WATERMARK_POSITION || 'bottom',
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    API_URL: env.API_URL || '',
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',

    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
  };
}

/**
 * Format waktu sekarang sesuai timezone yang diberikan.
 * Diekspor karena di-import oleh bot.js/features.js.
 */
export function formatNowTZ(tz = 'Asia/Jakarta') {
  try {
    return new Date().toLocaleString('id-ID', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    // fallback universal jika TZ tidak valid
    return new Date().toISOString();
  }
}
