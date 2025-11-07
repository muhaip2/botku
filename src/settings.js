// src/settings.js

// === KV key constants (dipakai lintas modul) ===
export const KV_SUBS           = 'subs:list';
export const KV_REMOTE_POOL    = 'pool:remote:v1';
export const KV_BCAST          = 'bcast:cur';
export const KV_TRAFFIC_DAILY  = 'traffic:daily:';      // +YYYYMMDD => { bytesOut }
export const KV_COUNTRY_CACHE  = 'country:counts:v1';   // cache hitung negara
export const STATS_GLOBAL      = 'stats:global';
export const STATS_DAILY_PREFIX= 'stats:daily:';
export const STATS_USER_PREFIX = 'stats:user:';
export const RL_BUCKET_PREFIX  = 'rl:bucket:';
export const RL_COOLDOWN_PREFIX= 'rl:cooldown:';

// Util: tanggal dengan zona waktu Indonesia (atau ENV)
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

// Baca ENV dan kembalikan object pengaturan
export function buildSettings(env) {
  const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;

  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    API_URL: env.API_URL || '',
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    PASSUUID: env.PASSUUID || '',

    ADMIN_IDS: (env.ADMIN_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),

    ADMIN_WATERMARK: env.ADMIN_WATERMARK || '',
    WATERMARK_POSITION:
      (env.WATERMARK_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom',

    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    // Pool & performa
    PROXY_POOL: (env.PROXY_POOL || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),

    REQ_DELAY_MS: num(env.REQ_DELAY_MS, 35),   // jeda antar request meta
  };
}
