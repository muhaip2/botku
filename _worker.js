// worker_inline_menu_stats_tz_watermark_bimg.js — Cloudflare Worker (modules)
// Ready to deploy: inline menu, broadcast+preview (text/photo URL/photo from gallery via file_id),
// GitHub proxy pool (KV cache), random config (TLS/NTLS) + Clash YAML (gRPC + VLESS REALITY),
// stats (+7-day trend), timezone-aware display, rate limiter/cooldown,
// and GLOBAL WATERMARK (bottom).
//
// ---------- wrangler.toml (template) ----------
// name = "tg-bot-worker"
// main = "worker_inline_menu_stats_tz_watermark_bimg.js"
// compatibility_date = "2024-11-01"
//
// [[kv_namespaces]]
// binding = "SUBSCRIBERS"
// id = "YOUR_KV_NAMESPACE_ID"
// preview_id = "YOUR_KV_NAMESPACE_PREVIEW_ID"
//
// [vars]
// TELEGRAM_API_URL = "https://api.telegram.org/bot<YOUR_TOKEN>/"
// API_URL = "https://example.com/api?ip="
// SERVER_WILDCARD = "your-wildcard.example"
// SERVER_VLESS = "your-cf-domain.example"
// SERVER_TROJAN = "your-cf-domain.example"
// PASSUUID = "your-uuid"
// ADMIN_IDS = "123456789,987654321"
// TIMEZONE = "Asia/Jakarta"
//
// // Watermark (bottom)
// ADMIN_WATERMARK = "━━━━━━━━━━━━━━━━━━━\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE\n━━━━━━━━━━━━━━━━━━━"
// WATERMARK_POSITION = "bottom"   // bottom|top (default bottom)
//
// // Remote pool (opsional)
// PROXY_POOL_URL = "https://raw.githubusercontent.com/user/repo/branch/proxies.txt"
// PROXY_POOL_TTL = "900"
//
// // Transports opsional
// USE_GRPC = "true"
// GRPC_SERVICE_NAME = "grpc"
// ENABLE_REALITY = "true"
// REALITY_SERVER = "your-reality-host.example"
// REALITY_PORT = "443"
// REALITY_PUBLIC_KEY = "xxxxx"
// REALITY_SHORT_ID = "abcd"
// REALITY_SNI = "www.cloudflare.com"
// REALITY_FINGERPRINT = "chrome"
//
// // Limiter & Cooldown (opsional)
// LIMIT_MAX_PER_MIN = "30"
// LIMIT_BURST = "20"
// CMD_COOLDOWN_MS = "1500"
//
// ------------------------------------------------------------

/* ================== KV Keys ================== */
const KV_KEY_SUBS = 'subscribers:list';
const KV_KEY_BCAST = 'broadcast:current';
const KV_KEY_REMOTE_POOL = 'pool:remote:v1'; // { updatedAt, list: [] }
const KV_KEY_BIMG_PREFIX = 'bimg:'; // per-admin gallery broadcast state

const STATS_GLOBAL = 'stats:global';
const STATS_USER_PREFIX = 'stats:user:';
const STATS_DAILY_PREFIX = 'stats:daily:'; // + YYYYMMDD (UTC buckets)
const STATS_CMD_PREFIX = 'stats:cmd:';
const RL_BUCKET_PREFIX = 'rl:bucket:';        // + userId
const RL_COOLDOWN_PREFIX = 'rl:cooldown:';    // + userId + ':' + cmd

/* ================== Settings ================== */
function buildSettings(env) {
  const ADMIN_IDS = env.ADMIN_IDS ? String(env.ADMIN_IDS).split(',').map(s => s.trim()).filter(Boolean) : [];
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const bool = (v, d=false) => {
    if (v === undefined || v === null) return d;
    const s = String(v).toLowerCase().trim();
    return ['1','true','yes','on'].includes(s);
  };

  let WILDCARD_MAP = { cache:"cache.netflix.com", quiz:"quiz.vidio.com", support:"support.zoom.us" };
  if (env.WILDCARD_MAP_JSON) { try { const parsed = JSON.parse(env.WILDCARD_MAP_JSON); if (parsed && typeof parsed === 'object') WILDCARD_MAP = parsed; } catch {} }
  const WILDCARD_KEYS = env.WILDCARD_KEYS ? String(env.WILDCARD_KEYS).split(',').map(s=>s.trim()).filter(Boolean) : Object.keys(WILDCARD_MAP);
  const PROXY_POOL = env.PROXY_POOL ? String(env.PROXY_POOL).split(',').map(s=>s.trim()).filter(Boolean) : [];

  return {
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    API_URL: env.API_URL || '',
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    PASSUUID: env.PASSUUID || '',
    ADMIN_IDS,
    // Watermark
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || "━━━━━━━━━━━━━━━━━━━\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE\n━━━━━━━━━━━━━━━━━━━",
    WATERMARK_POSITION: (env.WATERMARK_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom',
    // Batching/Broadcast
    BATCH_SIZE: num(env.BATCH_SIZE, 25),
    BATCH_DELAY_MS: num(env.BATCH_DELAY_MS, 1200),
    REQ_DELAY_MS: num(env.REQ_DELAY_MS, 35),
    MAX_RETRIES: num(env.MAX_RETRIES, 3),
    BACKOFF_MS: num(env.BACKOFF_MS, 500),
    // Wildcards & pool
    WILDCARD_MAP, WILDCARD_KEYS, PROXY_POOL,
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),
    // Transports
    USE_GRPC: bool(env.USE_GRPC, false),
    GRPC_SERVICE_NAME: env.GRPC_SERVICE_NAME || 'grpc',
    ENABLE_REALITY: bool(env.ENABLE_REALITY, false),
    REALITY_SERVER: env.REALITY_SERVER || '',
    REALITY_PORT: num(env.REALITY_PORT, 443),
    REALITY_PUBLIC_KEY: env.REALITY_PUBLIC_KEY || '',
    REALITY_SHORT_ID: env.REALITY_SHORT_ID || '',
    REALITY_SNI: env.REALITY_SNI || '',
    REALITY_FINGERPRINT: env.REALITY_FINGERPRINT || 'chrome',
    // Limiter
    LIMIT_MAX_PER_MIN: Math.max(1, num(env.LIMIT_MAX_PER_MIN, 30)),
    LIMIT_BURST: Math.max(1, num(env.LIMIT_BURST, 20)),
    CMD_COOLDOWN_MS: Math.max(0, num(env.CMD_COOLDOWN_MS, 1500)),
    // Timezone
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',
  };
}

/* ================== Utils ================== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => Date.now();
const nowIsoUTC = () => new Date().toISOString();
const todayKeyUTC = (offsetDays=0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${y}${m}${dd}`;
};
const lastNDaysKeysUTC = (n) => {
  const out = [];
  for (let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i));
  return out;
};
function fmtDateInTZ(d, tz='UTC') {
  const o = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute:'2-digit', second:'2-digit', hour12: false
  }).formatToParts(d).reduce((acc,p)=>{ acc[p.type]=p.value; return acc; },{});
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}`;
}
function labelFromUTCKeyInTZ(yyyymmdd, tz='UTC') {
  const y = Number(yyyymmdd.slice(0,4));
  const m = Number(yyyymmdd.slice(4,6));
  const d = Number(yyyymmdd.slice(6,8));
  const utcDate = new Date(Date.UTC(y, m-1, d));
  const o = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month:'2-digit', day:'2-digit' }).formatToParts(utcDate)
    .reduce((acc,p)=>{ acc[p.type]=p.value; return acc; },{});
  return `${o.month}/${o.day}`;
}

/* ================== KV Helpers (subs/broadcast/prefix) ================== */
async function kvGetSubscribers(env) { const raw = await env.SUBSCRIBERS.get(KV_KEY_SUBS); if (!raw) return new Set(); try { return new Set(JSON.parse(raw).map(String)); } catch { return new Set(); } }
async function kvSaveSubscribers(env, set) { await env.SUBSCRIBERS.put(KV_KEY_SUBS, JSON.stringify(Array.from(set))); }
async function addSubscriber(env, chatId) { const s = await kvGetSubscribers(env); s.add(String(chatId)); await kvSaveSubscribers(env, s); }
async function listSubscribers(env) { return Array.from(await kvGetSubscribers(env)); }
async function kvGetBroadcast(env) { const raw = await env.SUBSCRIBERS.get(KV_KEY_BCAST); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
async function kvSetBroadcast(env, obj) { await env.SUBSCRIBERS.put(KV_KEY_BCAST, JSON.stringify(obj)); }
async function kvListAll(env, prefix) {
  let cursor = undefined; const keys = [];
  while (true) {
    const r = await env.SUBSCRIBERS.list({ prefix, cursor });
    keys.push(...r.keys.map(k => k.name));
    if (!r.list_complete && r.cursor) cursor = r.cursor; else break;
  }
  return keys;
}

/* ================== Telegram API + Watermark ================== */
function applyWatermark(text, settings) {
  const wm = (settings.ADMIN_WATERMARK || '').trim();
  if (!wm) return text;
  if (settings.WATERMARK_POSITION === 'top') return wm + '\n' + text;
  return (text ? (text + '\n') : '') + wm;
}
async function sendMessage(settings, chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text: applyWatermark(text, settings), parse_mode: 'Markdown', disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`);
  return res.json().catch(()=>({}));
}
async function editMessage(settings, chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text: applyWatermark(text, settings), parse_mode: 'Markdown', disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(settings.TELEGRAM_API_URL + 'editMessageText', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(()=>({}));
}
async function sendPhoto(settings, chatId, photoUrlOrFileId, caption = '') {
  const body = { chat_id: chatId, photo: photoUrlOrFileId };
  if (caption !== undefined) { body.caption = applyWatermark(caption || '', settings); body.parse_mode = 'Markdown'; }
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`sendPhoto failed: ${res.status}`);
  return res.json().catch(()=>({}));
}
async function sendDocumentFromText(settings, chatId, filename, content, caption='') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption !== undefined) fd.append('caption', applyWatermark(caption || '', settings));
  const file = new File([content], filename, { type: 'text/yaml' });
  fd.append('document', file, filename);
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendDocument', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`sendDocument failed: ${res.status}`);
  return res.json().catch(()=>({}));
}
async function answerInlineQuery(settings, inlineQueryId, results, options={}) {
  const payload = { inline_query_id: inlineQueryId, results };
  Object.assign(payload, options);
  const res = await fetch(settings.TELEGRAM_API_URL + 'answerInlineQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`answerInlineQuery failed: ${res.status}`);
}
async function answerCallbackQuery(settings, callbackQueryId, text = null, showAlert = false) {
  const body = { callback_query_id: callbackQueryId };
  if (text) { body.text = text; body.show_alert = showAlert; }
  await fetch(settings.TELEGRAM_API_URL + 'answerCallbackQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/* ================== Stats helpers ================== */
async function statsGet(env, key) { const raw = await env.SUBSCRIBERS.get(key); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
async function statsSet(env, key, obj) { await env.SUBSCRIBERS.put(key, JSON.stringify(obj)); }
async function statsIncr(env, key, field, by=1) {
  const cur = await statsGet(env, key) || {};
  cur[field] = (cur[field] || 0) + by;
  await statsSet(env, key, cur);
  return cur[field];
}
async function statsPushCmd(env, cmd) { await statsIncr(env, STATS_CMD_PREFIX + cmd, 'count', 1); }
async function statsEnsureUserCount(env) {
  const subs = await kvGetSubscribers(env);
  const g = await statsGet(env, STATS_GLOBAL) || {};
  g.totalUsers = subs.size;
  await statsSet(env, STATS_GLOBAL, g);
}
async function statsTrackMessage(env, userId, username, chatType, cmdName='message') {
  const dayKey = STATS_DAILY_PREFIX + todayKeyUTC();
  const userKey = STATS_USER_PREFIX + userId;
  const g = await statsGet(env, STATS_GLOBAL) || { totalMessages:0, totalInline:0, totalUsers:0 };
  g.totalMessages = (g.totalMessages||0) + 1;
  g.lastSeenAt = nowIsoUTC();
  await statsSet(env, STATS_GLOBAL, g);

  const u = await statsGet(env, userKey) || { messages:0, commands:{}, firstSeenAt: nowIsoUTC() };
  u.messages = (u.messages||0) + 1;
  u.username = username || u.username || '';
  u.lastSeenAt = nowIsoUTC();
  u.commands = u.commands || {};
  u.commands[cmdName] = (u.commands[cmdName] || 0) + 1;
  await statsSet(env, userKey, u);

  const d = await statsGet(env, dayKey) || { messages:0, inline:0, messages_private:0, messages_group:0 };
  d.messages = (d.messages||0) + 1;
  if (chatType === 'private') d.messages_private = (d.messages_private||0) + 1;
  else d.messages_group = (d.messages_group||0) + 1;
  await statsSet(env, dayKey, d);
}
async function statsTrackInline(env, userId, queryText) {
  const g = await statsGet(env, STATS_GLOBAL) || { totalMessages:0, totalInline:0, totalUsers:0 };
  g.totalInline = (g.totalInline||0) + 1; g.lastSeenAt = nowIsoUTC();
  await statsSet(env, STATS_GLOBAL, g);

  const uKey = STATS_USER_PREFIX + userId;
  const u = await statsGet(env, uKey) || { messages:0, commands:{}, firstSeenAt: nowIsoUTC() };
  u.inline = (u.inline||0) + 1; u.lastSeenAt = nowIsoUTC(); u.lastInlineQuery = queryText || '';
  await statsSet(env, uKey, u);

  const dKey = STATS_DAILY_PREFIX + todayKeyUTC();
  const d = await statsGet(env, dKey) || { messages:0, inline:0, messages_private:0, messages_group:0 };
  d.inline = (d.inline||0) + 1;
  await statsSet(env, dKey, d);
}
const SPARK = ['▁','▂','▃','▄','▅','▆','▇','█'];
function sparkline(arr) {
  if (!arr.length) return '(no data)';
  const min = Math.min(...arr), max = Math.max(...arr);
  if (max === min) return SPARK[0].repeat(arr.length);
  return arr.map(v => {
    const idx = Math.floor((v - min) / (max - min) * (SPARK.length - 1));
    return SPARK[idx];
  }).join('');
}
async function buildTrends(env, tz, days=7) {
  const utcKeys = lastNDaysKeysUTC(days);
  const vals = await Promise.all(utcKeys.map(k => statsGet(env, STATS_DAILY_PREFIX + k)));
  const totals = vals.map(v => (v?.messages)||0);
  const privs  = vals.map(v => (v?.messages_private)||0);
  const groups = vals.map(v => (v?.messages_group)||0);
  const inls   = vals.map(v => (v?.inline)||0);
  const labels = utcKeys.map(k => labelFromUTCKeyInTZ(k, tz));
  const pack = (title, arr) => `${title}\n${sparkline(arr)}\n${labels.map((l,i)=>`${l}:${arr[i]}`).join('  ')}`;
  return [
    pack('📈 Total', totals),
    pack('👤 Private', privs),
    pack('👥 Group', groups),
    pack('🔎 Inline', inls),
  ].join('\n\n');
}

/* ================== Remote Pool Loader ================== */
function parsePoolText(text) { return text.split(/\r?\n|,/).map(x => x.trim()).filter(x => x && !x.startsWith('#')); }
async function fetchRemotePool(settings) {
  const res = await fetch(settings.PROXY_POOL_URL, { method: 'GET' });
  if (!res.ok) throw new Error(`remote pool fetch failed: ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await res.json();
    if (Array.isArray(data)) return data.map(String);
    if (data && Array.isArray(data.list)) return data.list.map(String);
    throw new Error('invalid JSON format for pool');
  } else {
    const text = await res.text(); return parsePoolText(text);
  }
}
async function getMergedPool(settings, env, { forceRefresh=false } = {}) {
  const local = settings.PROXY_POOL || [];
  let remote = [];
  if (settings.PROXY_POOL_URL) {
    const cachedRaw = await env.SUBSCRIBERS.get(KV_KEY_REMOTE_POOL);
    let cached = null; if (cachedRaw) { try { cached = JSON.parse(cachedRaw); } catch {} }
    const now = ts();
    if (!forceRefresh && cached && Array.isArray(cached.list) && (now - (cached.updatedAt||0) < settings.PROXY_POOL_TTL*1000)) {
      remote = cached.list;
    } else {
      try { const fresh = await fetchRemotePool(settings); remote = fresh; await env.SUBSCRIBERS.put(KV_KEY_REMOTE_POOL, JSON.stringify({ updatedAt: now, list: remote })); }
      catch (e) { if (cached && Array.isArray(cached.list)) remote = cached.list; else remote = []; }
    }
  }
  return Array.from(new Set([...local, ...remote]));
}

/* ================== Wildcard helpers ================== */
function getWildcardHostByKey(settings, key) {
  const val = settings.WILDCARD_MAP[key];
  if (!val) return null;
  if (val.includes('.')) return val;
  if (!settings.SERVER_WILDCARD) return null;
  return `${val}.${settings.SERVER_WILDCARD}`;
}
function getRandomWildcardHost(settings) {
  const keys = settings.WILDCARD_KEYS.length ? settings.WILDCARD_KEYS : Object.keys(settings.WILDCARD_MAP);
  if (!keys.length) return null;
  const key = keys[Math.floor(Math.random() * keys.length)];
  return getWildcardHostByKey(settings, key);
}

/* ================== Random proxy ================== */
function parseIPPort(s) { const p = s.split(':'); if (p.length === 2) { const [ip, port] = p; return { ip, port }; } return { ip: s, port: '443' }; }
function isValidIP(ip) {
  const re4 = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const re6 = /^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;
  return re4.test(ip) || re6.test(ip);
}
function isValidPort(port) { const n = Number(port); return Number.isInteger(n) && n > 0 && n <= 0xffff; }
function pickRandomProxyFromList(list) {
  if (!list.length) return null;
  const raw = list[Math.floor(Math.random() * list.length)];
  const { ip, port } = parseIPPort(raw);
  if (!isValidIP(ip) || !isValidPort(port)) return null;
  return { ip, port };
}

/* ================== Link generators & Clash YAML ================== */
function genVlessTLS(settings, hostSNI, innerHost, innerPort, tag) {
  const uuid = settings.PASSUUID; const encTag = encodeURIComponent(tag || '');
  return `vless://${uuid}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${encTag}`;
}
function genVlessNTLS(settings, hostSNI, innerHost, innerPort, tag) {
  const uuid = settings.PASSUUID; const encTag = encodeURIComponent(tag || '');
  return `vless://${uuid}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${encTag}`;
}
function genTrojanTLS(settings, hostSNI, innerHost, innerPort, tag) {
  const uuid = settings.PASSUUID; const encTag = encodeURIComponent(tag || '');
  return `trojan://${uuid}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${encTag}`;
}
function genTrojanNTLS(settings, hostSNI, innerHost, innerPort, tag) {
  const uuid = settings.PASSUUID; const encTag = encodeURIComponent(tag || '');
  return `trojan://${uuid}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${encTag}`;
}
function clashVlessTLS(settings, name, hostSNI, innerHost, innerPort) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: vless`,
    `  server: ${hostSNI}`,
    `  port: 443`,
    `  uuid: ${uuid}`,
    `  network: ws`,
    `  tls: true`,
    `  sni: ${hostSNI}`,
    `  skip-cert-verify: true`,
    `  ws-opts:`,
    `    path: /vless=${innerHost}:${innerPort}`,
    `    headers:`,
    `      Host: ${hostSNI}`].join('\n');
}
function clashVlessNTLS(settings, name, hostSNI, innerHost, innerPort) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: vless`,
    `  server: ${hostSNI}`,
    `  port: 80`,
    `  uuid: ${uuid}`,
    `  network: ws`,
    `  tls: false`,
    `  ws-opts:`,
    `    path: /vless=${innerHost}:${innerPort}`,
    `    headers:`,
    `      Host: ${hostSNI}`].join('\n');
}
function clashTrojanTLS(settings, name, h
