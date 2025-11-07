// src/settings.js

// Util: format tanggal sesuai zona waktu
export function formatNowTZ(tz = 'Asia/Jakarta') {
  try {
    return new Date().toLocaleString('id-ID', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return new Date().toISOString();
  }
}

// Baca ENV dan kembalikan object settings yang dipakai bot
export function buildSettings(env) {
  const asBool = (v, d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());

  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    ADMIN_IDS: (env.ADMIN_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    // Watermark admin (opsional)
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || '',
    WATERMARK_POSITION:
      (env.WATERMARK_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom',

    // Opsi lain yang mungkin dipakai modul lain
    REQ_DELAY_MS: Number.isFinite(Number(env.REQ_DELAY_MS)) ? Number(env.REQ_DELAY_MS) : 35,
  };
}
