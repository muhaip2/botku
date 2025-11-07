// src/settings.js
export function buildSettings(env){
  const num = (v,d)=>Number.isFinite(Number(v))?Number(v):d;
  const bool=(v,d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());
  let WILDCARD_MAP = { cache:"cache.netflix.com", quiz:"quiz.vidio.com", support:"support.zoom.us" };
  if (env.WILDCARD_MAP_JSON) { try{ const j=JSON.parse(env.WILDCARD_MAP_JSON); if(j&&typeof j==='object') WILDCARD_MAP=j; }catch{} }

  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    API_URL: env.API_URL || '',
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    PASSUUID: env.PASSUUID || '',
    ADMIN_IDS: (env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || "────────────────────\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE",
    WATERMARK_POSITION: (env.WATERMARK_POSITION||'bottom').toLowerCase()==='top'?'top':'bottom',
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    // Pool
    PROXY_POOL: (env.PROXY_POOL||'').split(',').map(s=>s.trim()).filter(Boolean),
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),

    // UI
    COUNTRY_PAGE_SIZE: num(env.COUNTRY_PAGE_SIZE, 18),
    COUNTRY_LIST_LIMIT: num(env.COUNTRY_LIST_LIMIT, 50),
    MAX_ACTIVE_IP_LIST: num(env.MAX_ACTIVE_IP_LIST, 6),
    RANDOM_PROXY_COUNT: num(env.RANDOM_PROXY_COUNT, 10),

    // Cache
    COUNTRY_CACHE_TTL: num(env.COUNTRY_CACHE_TTL, 900), // 15 menit
    ACTIVE_IPS_TTL: num(env.ACTIVE_IPS_TTL, 300),       // 5 menit

    // Performa scan
    SCAN_LIMIT: num(env.SCAN_LIMIT, 400),               // batasi IP yang discan
    META_TIMEOUT_MS: num(env.META_TIMEOUT_MS, 1500),    // timeout tiap IP
    CONCURRENCY: num(env.CONCURRENCY, 12),              // jumlah paralel fetch
  };
}
