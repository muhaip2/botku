// src/settings.js

// ===== KV Keys (dipakai di kv.js & lainnya)
export const STATS_GLOBAL        = 'stats:global';
export const STATS_DAILY_PREFIX  = 'stats:day:';   // + YYYY-MM-DD (UTC)
export const STATS_USER_PREFIX   = 'stats:user:';  // + <userId>
export const SUBSCRIBERS_KEY     = 'subs:all';
export const KV_TRAFFIC_DAILY    = 'traffic:daily'; // kalau butuh tracking trafik

// Format tanggal jam sesuai timezone
export function formatNowTZ(tz = 'Asia/Jakarta', date = new Date()) {
  const fmt = new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return fmt.format(date);
}

// Kumpulkan semua ENV jadi satu objek setting
export function buildSettings(env) {
  // ADMIN_IDS: "123,456" -> [123,456]
  const adminIds = String(env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(n => Number(n));

  return {
    // ENV yang dipakai bot
    TELEGRAM_API_URL : env.TELEGRAM_API_URL,     // ex: https://api.telegram.org/botXXXXXXXX:YYY/
    API_URL          : env.API_URL,              // endpoint ip probe
    SERVER_VLESS     : env.SERVER_VLESS,
    SERVER_TROJAN    : env.SERVER_TROJAN,
    SERVER_WILDCARD  : env.SERVER_WILDCARD,
    PROXY_POOL_URL   : env.PROXY_POOL_URL,
    TIMEZONE         : env.TIMEZONE || 'Asia/Jakarta',
    WATERMARK_POSITION: env.WATERMARK_POSITION || 'bottom',
    ADMIN_WATERMARK  : env.ADMIN_WATERMARK || '',
    ADMIN_IDS        : adminIds,

    // Binding
    KV               : env.BOT_DATA, // Cloudflare Pages KV binding (lihat “Bindings”)
  };
}

// Util: kunci harian UTC (YYYY-MM-DD)
export function todayKeyUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
    }
