// worker_no_inline_bimg.js — Cloudflare Worker (Modules)
// Webhook-only (NO inline). Broadcast text/photo (URL & galeri file_id) + preview,
// random proxy with filters (ISP & country + flag), random config TLS/NTLS,
// Clash YAML (gRPC + VLESS REALITY), stats 7 days (TZ), rate limiter, watermark.
//
// ENV penting (lihat wrangler.toml kamu):
// - TELEGRAM_API_URL (secret): https://api.telegram.org/bot<YOUR_TOKEN>/
// - API_URL, SERVER_WILDCARD, SERVER_VLESS, SERVER_TROJAN, PASSUUID
// - ADMIN_IDS, TIMEZONE, ADMIN_WATERMARK, WATERMARK_POSITION
// Opsional: PROXY_POOL_URL, PROXY_POOL_TTL, USE_GRPC, ENABLE_REALITY, REALITY_*
// Limiter: LIMIT_MAX_PER_MIN, LIMIT_BURST, CMD_COOLDOWN_MS

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
    REQ_DELAY_MS: num(env.REQ_DELAY_MS, 35),
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
  const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays);
  const y = d.getUTCFullYear(); const m = String(d.getUTCMonth()+1).padStart(2,'0'); const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${y}${m}${dd}`;
};
const lastNDaysKeysUTC = (n) => { const out=[]; for (let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; };
function fmtDateInTZ(d, tz='UTC') {
  const o = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
    .formatToParts(d).reduce((a,p)=>{a[p.type]=p.value; return a;},{});
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}:${o.second}`;
}
function labelFromUTCKeyInTZ(yyyymmdd, tz='UTC') {
  const y=+yyyymmdd.slice(0,4), m=+yyyymmdd.slice(4,6), d=+yyyymmdd.slice(6,8);
  const utcDate = new Date(Date.UTC(y, m-1, d));
  const o = new Intl.DateTimeFormat('en-GB', { timeZone: tz, month:'2-digit', day:'2-digit' })
    .formatToParts(utcDate).reduce((a,p)=>{a[p.type]=p.value; return a;},{});
  return `${o.month}/${o.day}`;
}

/* ================== KV Helpers ================== */
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
  return res.json().catch(()=>({}));
}
async function sendDocumentFromText(settings, chatId, filename, content, caption='') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption !== undefined) fd.append('caption', applyWatermark(caption || '', settings));
  const file = new File([content], filename, { type: 'text/yaml' });
  fd.append('document', file, filename);
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendDocument', { method: 'POST', body: fd });
  return res.json().catch(()=>({}));
}
async function answerCallbackQuery(settings, callbackQueryId, text = null, showAlert = false) {
  const body = { callback_query_id: callbackQueryId };
  if (text) { body.text = text; body.show_alert = showAlert; }
  await fetch(settings.TELEGRAM_API_URL + 'answerCallbackQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/* ================== Stats helpers ================== */
async function statsGet(env, key) { const raw = await env.SUBSCRIBERS.get(key); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
async function statsSet(env, key, obj) { await env.SUBSCRIBERS.put(key, JSON.stringify(obj)); }
async function statsIncr(env, key, field, by=1) { const cur = await statsGet(env, key) || {}; cur[field] = (cur[field] || 0) + by; await statsSet(env, key, cur); return cur[field]; }
async function statsPushCmd(env, cmd) { await statsIncr(env, STATS_CMD_PREFIX + cmd, 'count', 1); }
async function statsEnsureUserCount(env) { const subs = await kvGetSubscribers(env); const g = await statsGet(env, STATS_GLOBAL) || {}; g.totalUsers = subs.size; await statsSet(env, STATS_GLOBAL, g); }
async function statsTrackMessage(env, userId, username, chatType, cmdName='message') {
  const dayKey = STATS_DAILY_PREFIX + todayKeyUTC();
  const userKey = STATS_USER_PREFIX + userId;
  const g = await statsGet(env, STATS_GLOBAL) || { totalMessages:0, totalInline:0, totalUsers:0 };
  g.totalMessages = (g.totalMessages||0) + 1; g.lastSeenAt = nowIsoUTC(); await statsSet(env, STATS_GLOBAL, g);

  const u = await statsGet(env, userKey) || { messages:0, commands:{}, firstSeenAt: nowIsoUTC() };
  u.messages = (u.messages||0) + 1; u.username = username || u.username || ''; u.lastSeenAt = nowIsoUTC();
  u.commands = u.commands || {}; u.commands[cmdName] = (u.commands[cmdName] || 0) + 1; await statsSet(env, userKey, u);

  const d = await statsGet(env, dayKey) || { messages:0, inline:0, messages_private:0, messages_group:0 };
  d.messages = (d.messages||0) + 1;
  if (chatType === 'private') d.messages_private = (d.messages_private||0) + 1; else d.messages_group = (d.messages_group||0) + 1;
  await statsSet(env, dayKey, d);
}
const SPARK = ['▁','▂','▃','▄','▅','▆','▇','█'];
function sparkline(arr){ if(!arr.length) return '(no data)'; const min=Math.min(...arr), max=Math.max(...arr); if(max===min) return SPARK[0].repeat(arr.length); return arr.map(v=>SPARK[Math.floor((v-min)/(max-min)*(SPARK.length-1))]).join(''); }
async function buildTrends(env, tz, days=7) {
  const utcKeys = lastNDaysKeysUTC(days);
  const vals = await Promise.all(utcKeys.map(k => statsGet(env, STATS_DAILY_PREFIX + k)));
  const totals = vals.map(v => (v?.messages)||0);
  const privs  = vals.map(v => (v?.messages_private)||0);
  const groups = vals.map(v => (v?.messages_group)||0);
  const labels = utcKeys.map(k => labelFromUTCKeyInTZ(k, tz));
  const pack = (title, arr) => `${title}\n${sparkline(arr)}\n${labels.map((l,i)=>`${l}:${arr[i]}`).join('  ')}`;
  return [ pack('📈 Total', totals), pack('👤 Private', privs), pack('👥 Group', groups) ].join('\n\n');
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

/* ================== Random proxy + filtering (ISP / country / flag) ================== */
function parseIPPort(s) { const p = s.split(':'); if (p.length===2) {const [ip,port]=p; return {ip,port};} return {ip:s,port:'443'}; }
function isValidIP(ip){const re4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;const re6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;return re4.test(ip)||re6.test(ip);}
function isValidPort(port){const n=Number(port);return Number.isInteger(n)&&n>0&&n<=0xffff;}
function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function flagToCountryCode(flag){ if(!flag) return null; const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length!==2) return null; const A=0x1F1E6; const c1=String.fromCharCode(0x41+(cps[0]-A)); const c2=String.fromCharCode(0x41+(cps[1]-A)); return /[A-Z]{2}/.test(c1+c2) ? c1+c2 : null; }
function parseProxyFilter(text){
  const out={ cc:null, isp:null, countryLike:null };
  const parts=text.trim().split(/\s+/).filter(Boolean);
  for(const raw of parts){
    const s=raw.trim();
    if(/^isp:/i.test(s)) { out.isp=s.slice(4).trim().toLowerCase(); continue; }
    if(/^country:/i.test(s)) { out.countryLike=s.slice(8).trim().toLowerCase(); continue; }
    if(/^[A-Za-z]{2}$/.test(s)) { out.cc=s.toUpperCase(); continue; }
    const maybeCC=flagToCountryCode(s); if(maybeCC){ out.cc=maybeCC; continue; }
  }
  return out;
}
function metaMatchesFilter(meta, f){
  if(f.cc){
    if(!meta.country) return false;
    const ccFromFlag = flagToCountryCode(meta.flag||'');
    if(ccFromFlag && ccFromFlag!==f.cc) return false;
    if(!ccFromFlag && !new RegExp(`\\b${f.cc}\\b`,'i').test(meta.country)) return false;
  }
  if(f.isp){ if(!meta.isp || !meta.isp.toLowerCase().includes(f.isp)) return false; }
  if(f.countryLike){ if(!meta.country || !meta.country.toLowerCase().includes(f.countryLike)) return false; }
  return true;
}
async function pickProxyByFilter(settings, env, filter, opts={}) {
  const merged = await getMergedPool(settings, env, {});
  const list = shuffle(merged);
  const tries = Math.min(list.length, opts.maxTries || 40);
  for (let i=0;i<tries;i++){
    const raw=list[i]; const {ip,port}=parseIPPort(raw);
    if(!isValidIP(ip)||!isValidPort(port)) continue;
    try{
      const r=await fetch(settings.API_URL + encodeURIComponent(ip)+':'+encodeURIComponent(port));
      if(!r.ok) continue;
      const j=await r.json();
      if (!filter || (!filter.cc && !filter.isp && !filter.countryLike) || metaMatchesFilter(j, filter)) {
        return { ip, port, meta:j };
      }
    }catch{ /* keep trying */ }
    if (settings.REQ_DELAY_MS>0) await sleep(settings.REQ_DELAY_MS);
  }
  return null;
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
function clashTrojanTLS(settings, name, hostSNI, innerHost, innerPort) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: trojan`,
    `  server: ${hostSNI}`,
    `  port: 443`,
    `  password: ${uuid}`,
    `  network: ws`,
    `  tls: true`,
    `  sni: ${hostSNI}`,
    `  skip-cert-verify: true`,
    `  ws-opts:`,
    `    path: /trojan=${innerHost}:${innerPort}`,
    `    headers:`,
    `      Host: ${hostSNI}`].join('\n');
}
function clashTrojanNTLS(settings, name, hostSNI, innerHost, innerPort) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: trojan`,
    `  server: ${hostSNI}`,
    `  port: 80`,
    `  password: ${uuid}`,
    `  network: ws`,
    `  tls: false`,
    `  ws-opts:`,
    `    path: /trojan=${innerHost}:${innerPort}`,
    `    headers:`,
    `      Host: ${hostSNI}`].join('\n');
}
function clashVlessGrpcTLS(settings, name, hostSNI) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: vless`,
    `  server: ${hostSNI}`,
    `  port: 443`,
    `  uuid: ${uuid}`,
    `  network: grpc`,
    `  tls: true`,
    `  sni: ${hostSNI}`,
    `  skip-cert-verify: true`,
    `  grpc-opts:`,
    `    grpc-service-name: ${settings.GRPC_SERVICE_NAME}`].join('\n');
}
function clashTrojanGrpcTLS(settings, name, hostSNI) {
  const uuid = settings.PASSUUID;
  return ['proxies:',
    `- name: ${name}`,
    `  type: trojan`,
    `  server: ${hostSNI}`,
    `  port: 443`,
    `  password: ${uuid}`,
    `  network: grpc`,
    `  tls: true`,
    `  sni: ${hostSNI}`,
    `  skip-cert-verify: true`,
    `  grpc-opts:`,
    `    grpc-service-name: ${settings.GRPC_SERVICE_NAME}`].join('\n');
}
function clashVlessReality(settings, name) {
  return ['proxies:',
    `- name: ${name}`,
    `  type: vless`,
    `  server: ${settings.REALITY_SERVER}`,
    `  port: ${settings.REALITY_PORT}`,
    `  uuid: ${settings.PASSUUID}`,
    `  network: tcp`,
    `  udp: true`,
    `  tls: true`,
    `  servername: ${settings.REALITY_SNI}`,
    `  reality-opts:`,
    `    public-key: ${settings.REALITY_PUBLIC_KEY}`,
    `    short-id: ${settings.REALITY_SHORT_ID}`,
    `    fingerprint: ${settings.REALITY_FINGERPRINT}`].join('\n');
}
function bundleClashYaml(sections, name='Generated Config') {
  const proxies = []; const names = [];
  for (const sec of sections) {
    const lines = sec.split('\n');
    for (let i=1;i<lines.length;i++) { proxies.push(lines[i]); const line = lines[i].trim(); if (line.startsWith('- name:')) names.push(line.replace('- name:','').trim()); }
  }
  const listForGroup = names.map(n => `"${n}"`).join(', ');
  return [
    '# '+name,'mixed-port: 7890','allow-lan: true','mode: Rule','log-level: info','',
    'proxies:',...proxies,'',
    'proxy-groups:',
    `- name: AUTO`,`  type: url-test`,`  url: http://www.gstatic.com/generate_204`,`  interval: 600`,`  proxies: [${listForGroup}]`,
    '','rules:','  - MATCH,AUTO'
  ].join('\n');
}

/* ================== Limiter ================== */
async function statsGetSet(env, key, def){ const v=await statsGet(env,key); return v??def; }
async function rateCheck(env, settings, userId) {
  const key = RL_BUCKET_PREFIX + userId;
  const cap = settings.LIMIT_BURST;
  const ratePerSec = settings.LIMIT_MAX_PER_MIN / 60;
  const now = ts();
  let b = await statsGet(env, key) || { tokens: cap, updatedAt: now };
  const elapsed = Math.max(0, (now - (b.updatedAt||now)) / 1000);
  b.tokens = Math.min(cap, (b.tokens || cap) + elapsed * (ratePerSec||0));
  if (b.tokens < 1) { await statsSet(env, key, { tokens: b.tokens, updatedAt: now }); return false; }
  b.tokens -= 1; b.updatedAt = now; await statsSet(env, key, b); return true;
}
async function cooldownCheck(env, settings, userId, cmd) {
  const key = RL_COOLDOWN_PREFIX + userId + ':' + cmd;
  const now = ts();
  const last = await statsGet(env, key);
  if (last && (now - last.when < settings.CMD_COOLDOWN_MS)) return false;
  await statsSet(env, key, { when: now }); return true;
}
const HEAVY_CMDS = new Set(['random_config','random_config_wildcard','reload_pool','random_proxy','broadcast','broadcast_photo','broadcast_img']);

/* ================== Menu ================== */
function buildMainMenuKeyboard() {
  return { inline_keyboard: [
    [{ text: '🎲 Random Proxy', callback_data: 'OPEN_CMD|/random_proxy' },
     { text: '⚙️ Random Config', callback_data: 'OPEN_CMD|/random_config VLESS' }],
    [{ text: '🪄 Random + Wildcard', callback_data: 'OPEN_CMD|/random_config_wildcard VLESS' }],
    [{ text: '📦 Show Pool Count', callback_data: 'OPEN_CMD|/show_pool_count' },
     { text: '🔄 Reload Pool', callback_data: 'OPEN_CMD|/reload_pool' }]
  ]};
}
function mainMenuText() {
  return ['*Menu Bot*',
          '• Gunakan perintah:',
          '  `/random_proxy`',
          '  `/random_proxy isp:telkom id`',
          '  `/random_config VLESS`',
          '  `/random_config_wildcard VLESS`'
         ].join('\n');
}

/* ================== Broadcast (text & photo URL) ================== */
async function runBroadcast(env, settings, adminChatId) {
  let state = await kvGetBroadcast(env);
  if (!state || state.status !== 'pending') { await sendMessage(settings, adminChatId, '⚠️ Tidak ada broadcast pending.'); return; }
  state.status = 'running'; state.startedAt = nowIsoUTC();
  const subs = await listSubscribers(env);
  state.progress = state.progress || { total: subs.length, index: 0, success: 0, fail: 0 };
  await kvSetBroadcast(env, state);
  for (const cid of subs) {
    try { if (state.type === 'text') await sendMessage(settings, cid, state.payload.text); else await sendPhoto(settings, cid, state.payload.url, state.payload.caption || ''); state.progress.success++; }
    catch { state.progress.fail++; }
    state.progress.index++; await kvSetBroadcast(env, state);
    if (settings.REQ_DELAY_MS > 0) await sleep(settings.REQ_DELAY_MS);
  }
  state.status = 'done'; state.finishedAt = nowIsoUTC(); await kvSetBroadcast(env, state);
  await sendMessage(settings, adminChatId, `✅ Broadcast selesai.\nBerhasil: ${state.progress.success}\nGagal: ${state.progress.fail}`);
}

/* ================== Broadcast (gallery photo via file_id) ================== */
async function startBroadcastImageMode(env, settings, adminChatId) {
  if (!settings.ADMIN_IDS.includes(String(adminChatId))) { await sendMessage(settings, adminChatId, '❌ Khusus admin.'); return; }
  await env.SUBSCRIBERS.put(KV_KEY_BIMG_PREFIX + adminChatId, JSON.stringify({ type:'photo', status:'awaiting' }));
  await sendMessage(settings, adminChatId, '🖼 *Mode broadcast gambar aktif.*\nKirim *foto dari galeri* ke sini.\n\nKetik `/broadcast_img cancel` untuk membatalkan.');
}
async function runBroadcastImage(env, settings, adminChatId) {
  const raw = await env.SUBSCRIBERS.get(KV_KEY_BIMG_PREFIX + adminChatId);
  if (!raw) { await sendMessage(settings, adminChatId, '⚠️ Tidak ada broadcast gambar pending.'); return; }
  const state = JSON.parse(raw);
  if (state.status !== 'pending' || !state.file_id) { await sendMessage(settings, adminChatId, '⚠️ Kirim fotonya dulu untuk preview, lalu konfirmasi.'); return; }

  const subs = await listSubscribers(env);
  const total = subs.length;
  if (!total) { await sendMessage(settings, adminChatId, '❌ Tidak ada subscriber terdaftar.'); await env.SUBSCRIBERS.delete(KV_KEY_BIMG_PREFIX + adminChatId); return; }

  const startRes = await sendMessage(settings, adminChatId, `⏳ Memulai broadcast gambar…\nTotal user: *${total}*\nProgress: 0/${total}`);
  const statusMessageId = (await startRes)?.result?.message_id;
  let success=0, fail=0;

  for (let i=0;i<subs.length;i++) {
    const cid = subs[i];
    try {
      const out = await sendPhoto(settings, cid, state.file_id, state.caption || '');
      if (out?.ok) success++; else fail++;
    } catch { fail++; }
    if ((i+1)%5===0 || i===subs.length-1) {
      if (statusMessageId) {
        await editMessage(settings, adminChatId, statusMessageId, `🖼 *Broadcast Gambar*\nBerhasil: ${success}\nGagal: ${fail}\nProgress: ${i+1}/${total}`, {
          inline_keyboard: [[{ text: '⛔ Batal', callback_data: 'BIMG_CANCEL' }]]
        });
      }
    }
    await sleep(settings.REQ_DELAY_MS || 50);
  }
  if (statusMessageId) await editMessage(settings, adminChatId, statusMessageId, `✅ Selesai!\nBerhasil: ${success}\nGagal: ${fail}`);
  await env.SUBSCRIBERS.delete(KV_KEY_BIMG_PREFIX + adminChatId);
}

/* ================== Worker ================== */
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const settings = buildSettings(env);
      const body = await request.json();

      /* ---------- Callback (broadcast confirm/cancel + random proxy repick + open cmd) ---------- */
      if (body.callback_query) {
        const cb = body.callback_query;
        const chatId = String(cb.message?.chat?.id || '');
        const data = cb.data || '';

        // open command from menu buttons
        if (data.startsWith('OPEN_CMD|')) {
          const cmd = data.slice(9);
          await answerCallbackQuery(settings, cb.id, 'Menjalankan…');
          // kirim ke message handler via artificial text
          body.message = { chat:{ id: chatId, type: 'private' }, text: cmd, from: cb.from };
          delete body.callback_query;
        } else if (data.startsWith('BCAST_CONFIRM|')) {
          await answerCallbackQuery(settings, cb.id, 'Broadcast dimulai…');
          await runBroadcast(env, settings, chatId);
          return new Response('OK',{status:200});
        } else if (data.startsWith('BCAST_CANCEL|')) {
          await answerCallbackQuery(settings, cb.id, 'Broadcast dibatalkan.');
          const curr = await kvGetBroadcast(env); if (curr) { curr.status='canceled'; await kvSetBroadcast(env, curr); }
          return new Response('OK',{status:200});
        } else if (data === 'BIMG_CONFIRM') {
          await answerCallbackQuery(settings, cb.id, 'Mengirim gambar…');
          await runBroadcastImage(env, settings, chatId);
          return new Response('OK',{status:200});
        } else if (data === 'BIMG_CANCEL') {
          await answerCallbackQuery(settings, cb.id, 'Dibatalkan');
          await env.SUBSCRIBERS.delete(KV_KEY_BIMG_PREFIX + chatId);
          return new Response('OK',{status:200});
        } else if (data.startsWith('RPICK|')) {
          const raw = decodeURIComponent(data.slice(6) || '');
          const filter = raw ? parseProxyFilter(raw) : null;
          const pick = await pickProxyByFilter(settings, env, filter, { maxTries: 40 });
          if (!pick) {
            await answerCallbackQuery(settings, cb.id, 'Tidak ketemu. Coba lagi!');
            await sendMessage(settings, chatId, '❌ Tidak menemukan proxy yang cocok. Coba ulang / ganti filter.');
          } else {
            await answerCallbackQuery(settings, cb.id, 'Dapet!');
            const m = pick.meta || {};
            const flag = m.flag || '🏳️';
            const isp  = m.isp  || '(unknown ISP)';
            const ctry = m.country || '(unknown country)';
            const kb = { inline_keyboard: [[{ text: '🎲 Lagi (filter sama)', callback_data: 'RPICK|' + encodeURIComponent(raw) }]] };
            await sendMessage(settings, chatId,
              `🎲 *Random proxy*\n\`${pick.ip}:${pick.port}\`\n` +
              `👤 ISP: *${isp}*\n🌍 Country: *${ctry}* ${flag}`, kb);
          }
          return new Response('OK', { status: 200 });
        } else {
          await answerCallbackQuery(settings, cb.id);
          return new Response('OK', { status: 200 });
        }
      }

      /* ---------- Messages ---------- */
      if (body.message) {
        const msg = body.message;
        const chatId = String(msg.chat.id);
        const fromId = String(msg.from?.id || '');
        const username = (msg.from?.username ? '@'+msg.from.username : (msg.from?.first_name || ''));
        const chatType = String(msg.chat?.type || 'private'); // private/group/supergroup/channel
        const isAdmin = settings.ADMIN_IDS.map(String).includes(chatId);

        // Auto-subscribe & stats
        await addSubscriber(env, chatId);
        await statsTrackMessage(env, chatId, username, chatType, 'message');
        await statsEnsureUserCount(env);

        let text = (msg.text || '').trim();

        // Menu
        if (text.toLowerCase().startsWith('/menu')) {
          await sendMessage(settings, chatId, mainMenuText(), buildMainMenuKeyboard());
          await statsPushCmd(env, 'menu'); await statsTrackMessage(env, chatId, username, chatType, 'menu');
          return new Response('OK', { status: 200 });
        }

        // Limiter helper untuk perintah berat
        async function guard(userCmdName) {
          if (!HEAVY_CMDS.has(userCmdName)) return true;
          const passBucket = await rateCheck(env, settings, chatId);
          if (!passBucket) { await sendMessage(settings, chatId, '⏳ Terlalu cepat. Coba lagi sebentar lagi.'); return false; }
          const passCooldown = await cooldownCheck(env, settings, chatId, userCmdName);
          if (!passCooldown) { await sendMessage(settings, chatId, '🧊 Tunggu sebentar sebelum menjalankan perintah ini lagi.'); return false; }
          return true;
        }

        // User stats
        if (text === '/mystats') {
          const u = await statsGet(env, STATS_USER_PREFIX + chatId) || { messages:0, commands:{}, firstSeenAt:'-', lastSeenAt:'-' };
          const topCmds = Object.entries(u.commands||{}).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`• ${k}: ${v}`).join('\n') || '(belum ada)';
          const tz = settings.TIMEZONE;
          const lastSeenLocal = u.lastSeenAt ? fmtDateInTZ(new Date(u.lastSeenAt), tz) : '-';
          const firstSeenLocal = u.firstSeenAt ? fmtDateInTZ(new Date(u.firstSeenAt), tz) : '-';
          const reply = [
            `*Statistik Kamu (TZ: ${tz})*`,
            `ID: \`${chatId}\``,
            `Username: ${u.username || '-'}`,
            `Total interaksi: *${u.messages||0}*`,
            `Pertama kali: ${firstSeenLocal}`,
            `Terakhir: ${lastSeenLocal}`,
            '',
            '*Top perintah:*',
            topCmds
          ].join('\n');
          await sendMessage(settings, chatId, reply);
          await statsPushCmd(env, 'mystats'); await statsTrackMessage(env, chatId, username, chatType, 'mystats');
          return new Response('OK', { status: 200 });
        }

        // Admin dashboards
        if (isAdmin && text === '/stats') {
          const g = await statsGet(env, STATS_GLOBAL) || { totalMessages:0, totalUsers:0, totalInline:0, lastSeenAt:'-' };
          const tz = settings.TIMEZONE;
          const todayLocal = fmtDateInTZ(new Date(), tz).slice(0,10);
          const lastActiveLocal = g.lastSeenAt ? fmtDateInTZ(new Date(g.lastSeenAt), tz) : '-';
          const dayUTCKey = todayKeyUTC();
          const today = await statsGet(env, STATS_DAILY_PREFIX + dayUTCKey) || { messages:0, inline:0, messages_private:0, messages_group:0 };
          const trend = await buildTrends(env, tz, 7);
          const cmdKeys = await kvListAll(env, STATS_CMD_PREFIX);
          const cmdLines = [];
          for (const k of cmdKeys) { const n = await statsGet(env, k); cmdLines.push(`• ${k.replace(STATS_CMD_PREFIX,'')}: ${n?.count||0}`); }
          const reply = [
            `*Statistik Global (TZ: ${tz})*`,
            `Total user: *${g.totalUsers||0}*`,
            `Total pesan: *${g.totalMessages||0}*`,
            `Terakhir aktif: ${lastActiveLocal}`,
            '',
            `*Hari ini (${todayLocal})*`,
            `Private: *${today.messages_private||0}* | Group: *${today.messages_group||0}* | Total: *${today.messages||0}*`,
            '',
            '*Tren 7 hari*',
            '`' + trend + '`',
          ].join('\n');
          await sendMessage(settings, chatId, reply);
          await statsPushCmd(env, 'stats'); await statsTrackMessage(env, chatId, username, chatType, 'stats');
          return new Response('OK', { status: 200 });
        }

        if (isAdmin && text === '/reset_stats') {
          const namesUsers = await kvListAll(env, STATS_USER_PREFIX); for (const n of namesUsers) await env.SUBSCRIBERS.delete(n);
          const namesDaily = await kvListAll(env, STATS_DAILY_PREFIX); for (const n of namesDaily) await env.SUBSCRIBERS.delete(n);
          const namesCmd = await kvListAll(env, STATS_CMD_PREFIX); for (const n of namesCmd) await env.SUBSCRIBERS.delete(n);
          await env.SUBSCRIBERS.delete(STATS_GLOBAL);
          await sendMessage(settings, chatId, `♻️ Stats cleared.`);
          await statsPushCmd(env, 'reset_stats');
          return new Response('OK', { status: 200 });
        }

        // ================= Random Proxy (with filters) =================
        if (text.startsWith('/random_proxy')) {
          if (!(await guard('random_proxy'))) return new Response('OK', { status: 200 });
          const rawFilter = text.replace('/random_proxy','').trim();
          const filter = rawFilter ? parseProxyFilter(rawFilter) : null;
          const pick = await pickProxyByFilter(settings, env, filter, { maxTries: 40 });
          if (!pick) {
            await sendMessage(settings, chatId, '❌ Tidak menemukan proxy yang cocok.\nContoh: `/random_proxy isp:telkom id`');
          } else {
            const m = pick.meta || {};
            const flag = m.flag || '🏳️';
            const isp  = m.isp  || '(unknown ISP)';
            const ctry = m.country || '(unknown country)';
            const kb = { inline_keyboard: [[{ text: '🎲 Lagi (filter sama)', callback_data: 'RPICK|' + encodeURIComponent(rawFilter || '') }]] };
            await sendMessage(settings, chatId,
              `🎲 *Random proxy*\n\`${pick.ip}:${pick.port}\`\n` +
              `👤 ISP: *${isp}*\n🌍 Country: *${ctry}* ${flag}`, kb);
          }
          await statsPushCmd(env, 'random_proxy'); await statsTrackMessage(env, chatId, username, chatType, 'random_proxy');
          return new Response('OK', { status: 200 });
        }

        // ================= Random Config (direct) =================
        async function sendClashYamlBundle(proto, hostSNI, innerHost, innerPort, tag, toChatId) {
          const sections = [];
          if (proto === 'VLESS') {
            sections.push(clashVlessTLS(settings, `VLESS TLS ${tag}`, hostSNI, innerHost, innerPort));
            sections.push(clashVlessNTLS(settings, `VLESS NTLS ${tag}`, hostSNI, innerHost, innerPort));
            if (settings.USE_GRPC) sections.push(clashVlessGrpcTLS(settings, `VLESS gRPC ${tag}`, hostSNI));
            if (settings.ENABLE_REALITY && settings.REALITY_SERVER && settings.REALITY_PUBLIC_KEY) sections.push(clashVlessReality(settings, `VLESS REALITY ${tag}`));
          } else {
            sections.push(clashTrojanTLS(settings, `TROJAN TLS ${tag}`, hostSNI, innerHost, innerPort));
            sections.push(clashTrojanNTLS(settings, `TROJAN NTLS ${tag}`, hostSNI, innerHost, innerPort));
            if (settings.USE_GRPC) sections.push(clashTrojanGrpcTLS(settings, `TROJAN gRPC ${tag}`, hostSNI));
          }
          const yaml = bundleClashYaml(sections, `${proto} Bundle for ${tag}`);
          const filename = `${proto.toLowerCase()}_${Date.now()}.yaml`;
          await sendDocumentFromText(settings, toChatId, filename, yaml, `${proto} Clash YAML`);
        }

        if (text.startsWith('/random_config ')) {
          if (!(await guard('random_config'))) return new Response('OK', { status: 200 });
          const proto = text.slice(15).trim().toUpperCase();
          if (!['VLESS','TROJAN'].includes(proto)) { await sendMessage(settings, chatId, '❌ Gunakan: /random_config <VLESS|TROJAN>'); return new Response('OK', { status: 200 }); }
          const merged = await getMergedPool(settings, env, {});
          const raw = merged[Math.floor(Math.random()*merged.length)] || '';
          const { ip, port } = parseIPPort(raw);
          if (!isValidIP(ip) || !isValidPort(port)) { await sendMessage(settings, chatId, '❌ Pool kosong/invalid.'); return new Response('OK', { status: 200 }); }
          try {
            const r = await fetch(settings.API_URL + encodeURIComponent(ip) + ':' + encodeURIComponent(port));
            if (!r.ok) throw new Error('fetchIPData failed');
            const json = await r.json();
            const hostSNI = (proto === 'VLESS') ? settings.SERVER_VLESS : settings.SERVER_TROJAN;
            if (!hostSNI) { await sendMessage(settings, chatId, '❌ SERVER_VLESS/TROJAN belum diset.'); return new Response('OK',{status:200}); }
            const tag = `${json.isp || ip} ${json.flag || ''}`.trim();
            const innerHost = json.proxyHost || ip;
            const innerPort = json.proxyPort || port;

            const linkTLS  = (proto === 'VLESS') ? genVlessTLS(settings, hostSNI, innerHost, innerPort, tag) : genTrojanTLS(settings, hostSNI, innerHost, innerPort, tag);
            const linkNTLS = (proto === 'VLESS') ? genVlessNTLS(settings, hostSNI, innerHost, innerPort, tag) : genTrojanNTLS(settings, hostSNI, innerHost, innerPort, tag);
            await sendMessage(settings, chatId, `🔧 *Random ${proto} — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n*Salin cepat:* \`${linkTLS}\``);
            await sendMessage(settings, chatId, `🔓 *Random ${proto} — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\`\n*Salin cepat:* \`${linkNTLS}\``);
            await sendClashYamlBundle(proto, hostSNI, innerHost, innerPort, tag, chatId);
            await statsPushCmd(env, 'random_config_'+proto.toLowerCase()); await statsTrackMessage(env, chatId, username, chatType, 'random_config');
          } catch { await sendMessage(settings, chatId, `❌ Gagal ambil data untuk ${ip}:${port}`); }
          return new Response('OK', { status: 200 });
        }

        if (text.startsWith('/random_config_wildcard ')) {
          if (!(await guard('random_config_wildcard'))) return new Response('OK', { status: 200 });
          const proto = text.slice(23).trim().toUpperCase();
          if (!['VLESS','TROJAN'].includes(proto)) { await sendMessage(settings, chatId, '❌ Gunakan: /random_config_wildcard <VLESS|TROJAN>'); return new Response('OK', { status: 200 }); }
          const merged = await getMergedPool(settings, env, {});
          const raw = merged[Math.floor(Math.random()*merged.length)] || '';
          const { ip, port } = parseIPPort(raw);
          if (!isValidIP(ip) || !isValidPort(port)) { await sendMessage(settings, chatId, '❌ Pool kosong/invalid.'); return new Response('OK', { status: 200 }); }
          const wildcardHost = getRandomWildcardHost(settings);
          if (!wildcardHost) { await sendMessage(settings, chatId, '❌ Wildcard map/keys tidak valid.'); return new Response('OK', { status: 200 }); }
          try {
            const r = await fetch(settings.API_URL + encodeURIComponent(ip) + ':' + encodeURIComponent(port));
            if (!r.ok) throw new Error('fetchIPData failed');
            const json = await r.json();
            const tag = `${json.isp || ip} ${json.flag || ''}`.trim();
            const innerHost = json.proxyHost || ip;
            const innerPort = json.proxyPort || port;

            const linkTLS  = (proto === 'VLESS') ? genVlessTLS(settings, wildcardHost, innerHost, innerPort, tag) : genTrojanTLS(settings, wildcardHost, innerHost, innerPort, tag);
            const linkNTLS = (proto === 'VLESS') ? genVlessNTLS(settings, wildcardHost, innerHost, innerPort, tag) : genTrojanNTLS(settings, wildcardHost, innerHost, innerPort, tag);
            await sendMessage(settings, chatId, `🎯 *Random ${proto} + Wildcard — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n*Salin cepat:* \`${linkTLS}\``);
            await sendMessage(settings, chatId, `🎯 *Random ${proto} + Wildcard — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\`\n*Salin cepat:* \`${linkNTLS}\``);
            await sendClashYamlBundle(proto, wildcardHost, innerHost, innerPort, tag, chatId);
            await statsPushCmd(env, 'random_config_wildcard_'+proto.toLowerCase()); await statsTrackMessage(env, chatId, username, chatType, 'random_config_wildcard');
          } catch { await sendMessage(settings, chatId, `❌ Gagal ambil data untuk ${ip}:${port}`); }
          return new Response('OK', { status: 200 });
        }

        // ================= Admin: pool ops =================
        if (isAdmin && text === '/reload_pool') {
          if (!settings.PROXY_POOL_URL) { await sendMessage(settings, chatId, '❌ PROXY_POOL_URL belum diset.'); return new Response('OK', { status: 200 }); }
          try { const fresh = await fetchRemotePool(settings); await env.SUBSCRIBERS.put(KV_KEY_REMOTE_POOL, JSON.stringify({ updatedAt: ts(), list: fresh })); await sendMessage(settings, chatId, `✅ Pool remote dimuat. Total entri: ${fresh.length}`); }
          catch (e) { await sendMessage(settings, chatId, `❌ Gagal memuat pool remote: ${e.message || e}`); }
          await statsPushCmd(env, 'reload_pool'); await statsTrackMessage(env, chatId, username, chatType, 'reload_pool');
          return new Response('OK', { status: 200 });
        }
        if (isAdmin && text === '/show_pool_count') {
          const merged = await getMergedPool(settings, env, {});
          await sendMessage(settings, chatId, `📦 Pool gabungan: ${merged.length} entri.`);
          await statsPushCmd(env, 'show_pool_count'); await statsTrackMessage(env, chatId, username, chatType, 'show_pool_count');
          return new Response('OK', { status: 200 });
        }

        // ================= Broadcast commands =================
        if (isAdmin && text.startsWith('/broadcast ')) {
          const t = text.slice(11).trim();
          if (!t) await sendMessage(settings, chatId, '❌ Gunakan: /broadcast <pesan>');
          else {
            const state = { id: String(Date.now()), type: 'text', payload: { text: t }, status: 'pending', createdAt: nowIsoUTC(), progress: { total: (await listSubscribers(env)).length, index: 0, success: 0, fail: 0 } };
            await kvSetBroadcast(env, state);
            const kb = { inline_keyboard: [[{ text:'✅ Kirim', callback_data:`BCAST_CONFIRM|${state.id}` }, { text:'❌ Batal', callback_data:`BCAST_CANCEL|${state.id}` }]]};
            await sendMessage(settings, chatId, `📝 *Preview Broadcast Teks*\n\n${t}`, kb);
          }
          await statsPushCmd(env, 'broadcast'); await statsTrackMessage(env, chatId, username, chatType, 'broadcast');
          return new Response('OK', { status: 200 });
        }

        if (isAdmin && text.startsWith('/broadcast_photo ')) {
          const payloadStr = text.slice(17).trim();
          if (!payloadStr) {
            await sendMessage(settings, chatId, '❌ Gunakan: /broadcast_photo <image_url>|<caption (opsional)>');
          } else {
            let urlStr='', caption=''; const sep = payloadStr.indexOf('|');
            if (sep >= 0) { urlStr = payloadStr.slice(0, sep).trim(); caption = payloadStr.slice(sep+1).trim(); } else { urlStr = payloadStr.trim(); }
            if (!urlStr) await sendMessage(settings, chatId, '❌ URL gambar tidak valid.');
            else {
              const state = { id: String(Date.now()), type: 'photo', payload: { url: urlStr, caption }, status: 'pending', createdAt: nowIsoUTC(), progress: { total: (await listSubscribers(env)).length, index: 0, success: 0, fail: 0 } };
              await kvSetBroadcast(env, state);
              const kb = { inline_keyboard: [[{ text:'✅ Kirim', callback_data:`BCAST_CONFIRM|${state.id}` }, { text:'❌ Batal', callback_data:`BCAST_CANCEL|${state.id}` }]]};
              await sendPhoto(settings, chatId, urlStr, caption || ''); await sendMessage(settings, chatId, 'Konfirmasi broadcast foto di atas:', kb);
            }
          }
          await statsPushCmd(env, 'broadcast_photo'); await statsTrackMessage(env, chatId, username, chatType, 'broadcast_photo');
          return new Response('OK', { status: 200 });
        }

        if (isAdmin && text === '/broadcast_img') {
          await startBroadcastImageMode(env, settings, chatId);
          await statsPushCmd(env, 'broadcast_img'); await statsTrackMessage(env, chatId, username, chatType, 'broadcast_img');
          return new Response('OK', { status: 200 });
        }
        if (isAdmin && text === '/broadcast_img cancel') {
          await env.SUBSCRIBERS.delete(KV_KEY_BIMG_PREFIX + chatId);
          await sendMessage(settings, chatId, '❌ Mode broadcast gambar dibatalkan.');
          await statsPushCmd(env, 'broadcast_img_cancel'); await statsTrackMessage(env, chatId, username, chatType, 'broadcast_img_cancel');
          return new Response('OK', { status: 200 });
        }
        if (isAdmin && msg.photo) {
          const waiting = await env.SUBSCRIBERS.get(KV_KEY_BIMG_PREFIX + chatId);
          if (waiting) {
            const photos = msg.photo; const largest = photos[photos.length - 1];
            const fileId = largest.file_id; const caption = msg.caption || '';
            const state = { type:'photo', status:'pending', file_id:fileId, caption, createdAt: nowIsoUTC() };
            await env.SUBSCRIBERS.put(KV_KEY_BIMG_PREFIX + chatId, JSON.stringify(state));
            const kb = { inline_keyboard: [[{ text:'✅ Kirim ke semua', callback_data:'BIMG_CONFIRM' }],[{ text:'❌ Batal', callback_data:'BIMG_CANCEL' }]] };
            await sendPhoto(settings, chatId, fileId, `🖼 *Preview Broadcast Gambar*\n\n${caption}`);
            await sendMessage(settings, chatId, 'Konfirmasi pengiriman:', kb);
            return new Response('OK', { status: 200 });
          }
        }

        if (isAdmin && text === '/cancel_broadcast') {
          const curr = await kvGetBroadcast(env);
          if (curr && (curr.status === 'pending' || curr.status === 'running')) { curr.status = 'canceled'; await kvSetBroadcast(env, curr); await sendMessage(settings, chatId, '🛑 Broadcast dibatalkan.'); }
          else await sendMessage(settings, chatId, 'Tidak ada broadcast aktif untuk dibatalkan.');
          await statsPushCmd(env, 'cancel_broadcast'); await statsTrackMessage(env, chatId, username, chatType, 'cancel_broadcast');
          return new Response('OK', { status: 200 });
        }
        if (isAdmin && text === '/status_broadcast') {
          const curr = await kvGetBroadcast(env);
          if (!curr) await sendMessage(settings, chatId, 'ℹ️ Tidak ada broadcast.');
          else { const p = curr.progress || { total:0,index:0,success:0,fail:0 }; await sendMessage(settings, chatId, `📊 Status: *${curr.status}*\nID: \`${curr.id}\`\nTotal: ${p.total}\nPosisi: ${p.index}/${p.total}\nBerhasil: ${p.success}\nGagal: ${p.fail}`); }
          await statsPushCmd(env, 'status_broadcast'); await statsTrackMessage(env, chatId, username, chatType, 'status_broadcast');
          return new Response('OK', { status: 200 });
        }

        // Defaults
        if (text.startsWith('/start')) {
          await sendMessage(settings, chatId, 'Halo! Kamu otomatis jadi subscriber.\nPakai /menu untuk tombol & contoh perintah.');
          await statsPushCmd(env, 'start'); await statsTrackMessage(env, chatId, username, chatType, 'start');
          return new Response('OK', { status: 200 });
        }
        if (text) await sendMessage(settings, chatId, 'Pesan diterima ✅');
        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error(err);
      return new Response('Bad Request', { status: 400 });
    }
  }
};
