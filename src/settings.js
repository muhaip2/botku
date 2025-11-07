// src/settings.js — REPLACE isi file dengan ini

// ===== KV Keys (named exports) =====
export const KV_SUBS = 'subs:list';
export const KV_REMOTE_POOL = 'pool:remote:v1';
export const KV_BCAST = 'bcast:cur';

// ➜ INI YANG DICARI BUILDER
export const KV_TRAFFIC_DAILY = 'traffic:daily:'; // +YYYYMMDD => { bytesOut }

export const KV_COUNTRY_CACHE = 'country:counts:v1';
export const STATS_GLOBAL = 'stats:global';
export const STATS_DAILY_PREFIX = 'stats:daily:';
export const STATS_USER_PREFIX = 'stats:user:';
export const RL_BUCKET_PREFIX = 'rl:bucket:';
export const RL_COOLDOWN_PREFIX = 'rl:cooldown:';

// ===== Helper Settings =====
const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
const bool = (v, d=false) => v == null ? d : ['1','true','yes','on'].includes(String(v).toLowerCase());

// ===== Build settings (named export) =====
export function buildSettings(env) {
  let WILDCARD_MAP = {
    cache: "cache.netflix.com",
    quiz: "quiz.vidio.com",
    support: "support.zoom.us"
  };
  if (env.WILDCARD_MAP_JSON) {
    try {
      const j = JSON.parse(env.WILDCARD_MAP_JSON);
      if (j && typeof j === 'object') WILDCARD_MAP = j;
    } catch {}
  }

  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    API_URL: env.API_URL || '',
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    PASSUUID: env.PASSUUID || '',
    ADMIN_IDS: (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || "────────────────────\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE",
    WATERMARK_POSITION: (env.WATERMARK_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom',
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    // Pool
    PROXY_POOL: (env.PROXY_POOL || '').split(',').map(s => s.trim()).filter(Boolean),
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),

    // UI/logic
    REQ_DELAY_MS: num(env.REQ_DELAY_MS, 35),
    COUNTRY_PAGE_SIZE: num(env.COUNTRY_PAGE_SIZE, 18),
    COUNTRY_LIST_LIMIT: num(env.COUNTRY_LIST_LIMIT, 20),
    MAX_ACTIVE_IP_LIST: num(env.MAX_ACTIVE_IP_LIST, 6),
    RANDOM_PROXY_COUNT: num(env.RANDOM_PROXY_COUNT, 10),
    COUNTRY_CACHE_TTL: num(env.COUNTRY_CACHE_TTL, 600),

    // Rate-limit
    LIMIT_MAX_PER_MIN: Math.max(1, num(env.LIMIT_MAX_PER_MIN, 30)),
    LIMIT_BURST: Math.max(1, num(env.LIMIT_BURST, 20)),
    CMD_COOLDOWN_MS: Math.max(0, num(env.CMD_COOLDOWN_MS, 1200)),

    // Speedtest
    SPEED_PINGS: Math.max(3, num(env.SPEED_PINGS, 5)),
    SPEED_DL_BYTES: Math.max(2_000_000, num(env.SPEED_DL_BYTES, 10_000_000)),

    // Wildcard
    WILDCARD_MAP
  };
}
