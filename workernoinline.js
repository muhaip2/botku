// worker_no_inline_bimg.js — Cloudflare Worker (Modules)
// + Speedtest Cloudflare (/speedtest)
// + Bandwidth usage (/bandwidth) — hitung payload yang dikirim Worker ke Telegram API
// (fitur lain: popup /menu & /admin, /proxyip country picker -> pilih IP -> pilih protokol -> wildcard -> kirim config,
// broadcast teks/foto + preview/cancel, stats & tren 7 hari, watermark global, rate limiter, clash yaml, dll)

// ================== KV Keys ==================
const KV_KEY_SUBS = 'subscribers:list';
const KV_KEY_BCAST = 'broadcast:current';
const KV_KEY_REMOTE_POOL = 'pool:remote:v1';
const KV_KEY_BIMG_PREFIX = 'bimg:';

const STATS_GLOBAL = 'stats:global';
const STATS_USER_PREFIX = 'stats:user:';
const STATS_DAILY_PREFIX = 'stats:daily:';
const STATS_CMD_PREFIX = 'stats:cmd:';
const RL_BUCKET_PREFIX = 'rl:bucket:';
const RL_COOLDOWN_PREFIX = 'rl:cooldown:';

const TRAFFIC_DAILY_PREFIX = 'traffic:daily:'; // + YYYYMMDD  => { bytesOut: number }

// ================== Settings ==================
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
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || "━━━━━━━━━━━━━━━━━━━\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE\n━━━━━━━━━━━━━━━━━━━",
    WATERMARK_POSITION: (env.WATERMARK_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom',
    REQ_DELAY_MS: num(env.REQ_DELAY_MS, 35),
    WILDCARD_MAP, WILDCARD_KEYS, PROXY_POOL,
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),
    USE_GRPC: bool(env.USE_GRPC, false),
    GRPC_SERVICE_NAME: env.GRPC_SERVICE_NAME || 'grpc',
    ENABLE_REALITY: bool(env.ENABLE_REALITY, false),
    REALITY_SERVER: env.REALITY_SERVER || '',
    REALITY_PORT: num(env.REALITY_PORT, 443),
    REALITY_PUBLIC_KEY: env.REALITY_PUBLIC_KEY || '',
    REALITY_SHORT_ID: env.REALITY_SHORT_ID || '',
    REALITY_SNI: env.REALITY_SNI || '',
    REALITY_FINGERPRINT: env.REALITY_FINGERPRINT || 'chrome',
    LIMIT_MAX_PER_MIN: Math.max(1, num(env.LIMIT_MAX_PER_MIN, 30)),
    LIMIT_BURST: Math.max(1, num(env.LIMIT_BURST, 20)),
    CMD_COOLDOWN_MS: Math.max(0, num(env.CMD_COOLDOWN_MS, 1500)),
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',
    COUNTRY_PAGE_SIZE: Math.max(8, num(env.COUNTRY_PAGE_SIZE, 12)),
    MAX_ACTIVE_IP_LIST: Math.max(3, num(env.MAX_ACTIVE_IP_LIST, 6)),
    // Speedtest
    SPEED_PINGS: Math.max(3, num(env.SPEED_PINGS, 5)),
    SPEED_DL_BYTES: Math.max(2_000_000, num(env.SPEED_DL_BYTES, 10_000_000)) // 10MB default
  };
}

// ================== Utils ==================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ts = () => Date.now();
const nowIsoUTC = () => new Date().toISOString();
function todayKeyUTC(offset=0){ const d=new Date(); d.setUTCDate(d.getUTCDate()+offset); const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}${m}${dd}`; }
function lastNDaysKeysUTC(n){ const out=[]; for(let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; }

function applyWatermark(text, settings) {
  const wm = (settings.ADMIN_WATERMARK || '').trim();
  if (!wm) return text;
  if (settings.WATERMARK_POSITION === 'top') return wm + '\n' + text;
  return (text ? (text + '\n') : '') + wm;
}
function bytesHuman(n){
  if (!n) return '0 B';
  const u=['B','KB','MB','GB','TB']; let i=0; let x=n;
  while (x>=1024 && i<u.length-1){ x/=1024; i++; }
  return `${x.toFixed(x>=100?0:(x>=10?1:2))} ${u[i]}`;
}

// ================== KV helpers (ringkas) ==================
async function kvGet(env, key){ const raw=await env.SUBSCRIBERS.get(key); if(!raw) return null; try{return JSON.parse(raw);}catch{return null;} }
async function kvSet(env, key, obj){ await env.SUBSCRIBERS.put(key, JSON.stringify(obj)); }
async function kvList(env, prefix){ let cur; const keys=[]; while(true){ const r=await env.SUBSCRIBERS.list({prefix, cursor:cur}); keys.push(...r.keys.map(k=>k.name)); if(!r.list_complete&&r.cursor) cur=r.cursor; else break;} return keys;}
async function kvGetSubscribers(env){ const raw=await env.SUBSCRIBERS.get(KV_KEY_SUBS); if(!raw) return new Set(); try{return new Set(JSON.parse(raw).map(String));}catch{return new Set();}}
async function kvSaveSubscribers(env,set){ await env.SUBSCRIBERS.put(KV_KEY_SUBS, JSON.stringify(Array.from(set))); }
async function addSubscriber(env, chatId){ const s=await kvGetSubscribers(env); s.add(String(chatId)); await kvSaveSubscribers(env, s); }

// ================== Traffic accounting ==================
async function trackTraffic(env, bytes){
  const key = TRAFFIC_DAILY_PREFIX + todayKeyUTC();
  const cur = await kvGet(env, key) || { bytesOut: 0 };
  cur.bytesOut = (cur.bytesOut||0) + Math.max(0, bytes|0);
  await kvSet(env, key, cur);
}
async function getTrafficLast7(env){
  const keys = lastNDaysKeysUTC(7).map(k => TRAFFIC_DAILY_PREFIX + k);
  const vals = await Promise.all(keys.map(k => kvGet(env, k)));
  return vals.map(v => (v?.bytesOut)||0);
}
const SPARK = ['▁','▂','▃','▄','▅','▆','▇','█'];
function sparkline(arr){ if(!arr.length) return '(no data)'; const min=Math.min(...arr), max=Math.max(...arr); if(max===min) return SPARK[0].repeat(arr.length); return arr.map(v=>SPARK[Math.floor((v-min)/(max-min)*(SPARK.length-1))]).join(''); }

// ================== Telegram API (count payload bytes) ==================
async function sendMessage(settings, env, chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text: applyWatermark(text, settings), parse_mode: 'Markdown', disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const payload = JSON.stringify(body);
  await trackTraffic(env, payload.length);
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  return res.json().catch(()=>({}));
}
async function editMessage(settings, env, chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text: applyWatermark(text, settings), parse_mode: 'Markdown', disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const payload = JSON.stringify(body);
  await trackTraffic(env, payload.length);
  const res = await fetch(settings.TELEGRAM_API_URL + 'editMessageText', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  return res.json().catch(()=>({}));
}
async function sendPhoto(settings, env, chatId, photoUrlOrFileId, caption = '') {
  const body = { chat_id: chatId, photo: photoUrlOrFileId };
  if (caption !== undefined) { body.caption = applyWatermark(caption || '', settings); body.parse_mode = 'Markdown'; }
  const payload = JSON.stringify(body);
  await trackTraffic(env, payload.length);
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  return res.json().catch(()=>({}));
}
async function sendDocumentFromText(settings, env, chatId, filename, content, caption='') {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (caption !== undefined) fd.append('caption', applyWatermark(caption || '', settings));
  const file = new File([content], filename, { type: 'text/yaml' });
  fd.append('document', file, filename);
  // FormData ukurannya tidak trivial; kasar: caption+filename+content
  await trackTraffic(env, (caption||'').length + filename.length + content.length);
  const res = await fetch(settings.TELEGRAM_API_URL + 'sendDocument', { method: 'POST', body: fd });
  return res.json().catch(()=>({}));
}
async function answerCallbackQuery(settings, id, text = null, showAlert = false) {
  const body = { callback_query_id: id };
  if (text) { body.text = text; body.show_alert = showAlert; }
  // tidak dihitung agar sederhana (kecil)
  await fetch(settings.TELEGRAM_API_URL + 'answerCallbackQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ================== Stats kecil ==================
async function statsGet(env, key){ return kvGet(env,key); }
async function statsSet(env, key, obj){ return kvSet(env,key,obj); }
async function statsIncr(env,key,field,by=1){ const cur=await statsGet(env,key)||{}; cur[field]=(cur[field]||0)+by; await statsSet(env,key,cur); return cur[field]; }
async function statsPushCmd(env,c){ await statsIncr(env, STATS_CMD_PREFIX+c, 'count', 1); }
async function statsEnsureUserCount(env){ const subs=await kvGetSubscribers(env); const g=await statsGet(env, STATS_GLOBAL)||{}; g.totalUsers=subs.size; await statsSet(env, STATS_GLOBAL, g); }
async function statsTrackMessage(env, userId, username, chatType, cmd='message'){
  const dayKey = STATS_DAILY_PREFIX + todayKeyUTC();
  const userKey = STATS_USER_PREFIX + userId;
  const g = await statsGet(env, STATS_GLOBAL) || { totalMessages:0, totalUsers:0 };
  g.totalMessages = (g.totalMessages||0)+1; g.lastSeenAt = nowIsoUTC(); await statsSet(env, STATS_GLOBAL, g);
  const u = await statsGet(env, userKey) || { messages:0, commands:{}, firstSeenAt: nowIsoUTC() };
  u.messages=(u.messages||0)+1; u.username=username||u.username||''; u.lastSeenAt=nowIsoUTC(); u.commands[u.commands?cmd:cmd]=(u.commands?.[cmd]||0)+1; await statsSet(env, userKey, u);
  const d = await statsGet(env, dayKey) || { messages:0, messages_private:0, messages_group:0 };
  d.messages=(d.messages||0)+1; if(chatType==='private') d.messages_private=(d.messages_private||0)+1; else d.messages_group=(d.messages_group||0)+1; await statsSet(env, dayKey, d);
}

// ================== Country list & helpers (ringkas) ==================
const COUNTRY_CATALOG = [
  { cc:'ID', name:'Indonesia', flag:'🇮🇩' }, { cc:'US', name:'United States', flag:'🇺🇸' },
  { cc:'SG', name:'Singapore', flag:'🇸🇬' }, { cc:'JP', name:'Japan', flag:'🇯🇵' },
  { cc:'MY', name:'Malaysia', flag:'🇲🇾' }, { cc:'DE', name:'Germany', flag:'🇩🇪' },
  { cc:'GB', name:'United Kingdom', flag:'🇬🇧' }, { cc:'NL', name:'Netherlands', flag:'🇳🇱' },
  { cc:'HK', name:'Hong Kong', flag:'🇭🇰' }, { cc:'IN', name:'India', flag:'🇮🇳' },
  { cc:'AU', name:'Australia', flag:'🇦🇺' }, { cc:'FR', name:'France', flag:'🇫🇷' },
  { cc:'BR', name:'Brazil', flag:'🇧🇷' }, { cc:'TH', name:'Thailand', flag:'🇹🇭' },
  { cc:'PH', name:'Philippines', flag:'🇵🇭' }, { cc:'VN', name:'Vietnam', flag:'🇻🇳' },
  { cc:'RU', name:'Russia', flag:'🇷🇺' }, { cc:'CA', name:'Canada', flag:'🇨🇦' },
  { cc:'TR', name:'Turkey', flag:'🇹🇷' }, { cc:'CN', name:'China', flag:'🇨🇳' },
];
function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65)) + String.fromCodePoint(A+(c.charCodeAt(1)-65)); }
function flagToCC(flag){ const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length!==2) return null; const A=0x1F1E6; const c1=String.fromCharCode(0x41+(cps[0]-A)); const c2=String.fromCharCode(0x41+(cps[1]-A)); return c1+c2; }

// ================== Pool & validation (ringkas) ==================
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
function parseIPPort(s) { const p = s.split(':'); if (p.length===2) {const [ip,port]=p; return {ip,port};} return {ip:s,port:'443'}; }
function isValidIP(ip){const re4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;const re6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;return re4.test(ip)||re6.test(ip);}
function isValidPort(port){const n=Number(port);return Number.isInteger(n)&&n>0&&n<=0xffff;}

// ================== Wildcard helpers ==================
function getWildcardHostByKey(settings, key) {
  const val = settings.WILDCARD_MAP[key];
  if (!val) return null;
  if (val.includes('.')) return val;
  if (!settings.SERVER_WILDCARD) return null;
  return `${val}.${settings.SERVER_WILDCARD}`;
}
function getRandomWildcardHost(settings) {
  const keys = Object.keys(settings.WILDCARD_MAP);
  if (!keys.length) return null;
  const k = keys[Math.floor(Math.random()*keys.length)];
  return getWildcardHostByKey(settings, k);
}

// ================== Generators & header ==================
function genVlessTLS(s, hostSNI, innerHost, innerPort, tag) {
  const uuid=s.PASSUUID, enc=encodeURIComponent(tag||'');
  return `vless://${uuid}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`;
}
function genVlessNTLS(s, hostSNI, innerHost, innerPort, tag) {
  const uuid=s.PASSUUID, enc=encodeURIComponent(tag||'');
  return `vless://${uuid}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}
function genTrojanTLS(s, hostSNI, innerHost, innerPort, tag) {
  const uuid=s.PASSUUID, enc=encodeURIComponent(tag||'');
  return `trojan://${uuid}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`;
}
function genTrojanNTLS(s, hostSNI, innerHost, innerPort, tag) {
  const uuid=s.PASSUUID, enc=encodeURIComponent(tag||'');
  return `trojan://${uuid}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}
function buildConfigHeader(meta){
  const flag = meta.flag || '🏳️';
  const country = meta.country || 'Unknown';
  const isp = meta.isp || 'Unknown ISP';
  const ms = (meta.delay !== undefined && meta.delay !== null) ? `${meta.delay} ms` : '-';
  return `*${flag} ${country}* • *${isp}* • *${ms}*`;
}

// ================== Clash YAML (ringkas) ==================
function clashVlessTLS(s, name, hostSNI, innerHost, innerPort) {
  const uuid=s.PASSUUID;
  return ['proxies:','- name: '+name,'  type: vless','  server: '+hostSNI,'  port: 443','  uuid: '+uuid,'  network: ws','  tls: true','  sni: '+hostSNI,'  skip-cert-verify: true','  ws-opts:','    path: /vless='+innerHost+':'+innerPort,'    headers:','      Host: '+hostSNI].join('\n');
}
function clashVlessNTLS(s, name, hostSNI, innerHost, innerPort) {
  const uuid=s.PASSUUID;
  return ['proxies:','- name: '+name,'  type: vless','  server: '+hostSNI,'  port: 80','  uuid: '+uuid,'  network: ws','  tls: false','  ws-opts:','    path: /vless='+innerHost+':'+innerPort,'    headers:','      Host: '+hostSNI].join('\n');
}
function clashTrojanTLS(s, name, hostSNI, innerHost, innerPort) {
  const uuid=s.PASSUUID;
  return ['proxies:','- name: '+name,'  type: trojan','  server: '+hostSNI,'  port: 443','  password: '+uuid,'  network: ws','  tls: true','  sni: '+hostSNI,'  skip-cert-verify: true','  ws-opts:','    path: /trojan='+innerHost+':'+innerPort,'    headers:','      Host: '+hostSNI].join('\n');
}
function clashTrojanNTLS(s, name, hostSNI, innerHost, innerPort) {
  const uuid=s.PASSUUID;
  return ['proxies:','- name: '+name,'  type: trojan','  server: '+hostSNI,'  port: 80','  password: '+uuid,'  network: ws','  tls: false','  ws-opts:','    path: /trojan='+innerHost+':'+innerPort,'    headers:','      Host: '+hostSNI].join('\n');
}
function bundleClashYaml(sections, name='Generated Config') {
  const proxies=[]; const names=[];
  for (const sec of sections) { const lines=sec.split('\n'); for(let i=1;i<lines.length;i++){ proxies.push(lines[i]); const t=lines[i].trim(); if(t.startsWith('- name:')) names.push(t.replace('- name:','').trim()); } }
  const list = names.map(n=>`"${n}"`).join(', ');
  return ['# '+name,'mixed-port: 7890','allow-lan: true','mode: Rule','log-level: info','',
          'proxies:',...proxies,'','proxy-groups:','- name: AUTO','  type: url-test','  url: http://www.gstatic.com/generate_204','  interval: 600','  proxies: ['+list+']','',
          'rules:','  - MATCH,AUTO'].join('\n');
}

// ================== Limiter ==================
async function rateCheck(env, s, userId) {
  const key = RL_BUCKET_PREFIX + userId;
  const cap = s.LIMIT_BURST;
  const ratePerSec = s.LIMIT_MAX_PER_MIN / 60;
  const now = ts();
  let b = await statsGet(env, key) || { tokens: cap, updatedAt: now };
  const elapsed = Math.max(0, (now - (b.updatedAt||now)) / 1000);
  b.tokens = Math.min(cap, (b.tokens || cap) + elapsed * (ratePerSec||0));
  if (b.tokens < 1) { await statsSet(env, key, { tokens: b.tokens, updatedAt: now }); return false; }
  b.tokens -= 1; b.updatedAt = now; await statsSet(env, key, b); return true;
}
async function cooldownCheck(env, s, userId, cmd) {
  const key = RL_COOLDOWN_PREFIX + userId + ':' + cmd;
  const now = ts();
  const last = await statsGet(env, key);
  if (last && (now - last.when < s.CMD_COOLDOWN_MS)) return false;
  await statsSet(env, key, { when: now }); return true;
}
const HEAVY_CMDS = new Set(['random_config','random_config_wildcard','reload_pool','random_proxy','broadcast','broadcast_photo','broadcast_img','proxyip','speedtest']);

// ================== UI — Menus ==================
function buildUserMenuKeyboard() {
  return { inline_keyboard: [
    [{ text: '🎲 Random Proxy', callback_data: 'OPEN_CMD|/random_proxy' },
     { text: '🧩 Random Config', callback_data: 'OPEN_CMD|/random_config VLESS' }],
    [{ text: '🪄 Random + Wildcard', callback_data: 'OPEN_CMD|/random_config_wildcard VLESS' }],
    [{ text: '🌍 Pilih Negara (Proxy)', callback_data: 'OPEN_CMD|/proxyip' }],
    [{ text: '🚀 Speedtest', callback_data: 'OPEN_CMD|/speedtest' },
     { text: '📶 Bandwidth', callback_data: 'OPEN_CMD|/bandwidth' }],
    [{ text: '📦 Show Pool Count', callback_data: 'OPEN_CMD|/show_pool_count' }],
    [{ text: '⚙️ Menu Admin', callback_data: 'OPEN_CMD|/admin' }]
  ]};
}
function userMenuText() {
  return ['*Menu User*',
          '• `/random_proxy` — acak cepat.',
          '• `/proxyip` — pilih berdasarkan negara.',
          '• `/speedtest` — uji ping & unduh via Cloudflare.',
          '• `/bandwidth` — trafik hari ini & 7 hari.'
         ].join('\n');
}
function buildAdminMenuKeyboard() {
  return { inline_keyboard: [
    [{ text: '📝 Preview Broadcast', callback_data: 'OPEN_CMD|/broadcast Halo semua!' },
     { text: '🖼 Foto via URL', callback_data: 'OPEN_CMD|/broadcast_photo https://example.com/pic.jpg|Caption' }],
    [{ text: '📷 Mode Foto Galeri', callback_data: 'OPEN_CMD|/broadcast_img' }],
    [{ text: '📊 Stats', callback_data: 'OPEN_CMD|/stats' },
     { text: '♻️ Reset Stats', callback_data: 'OPEN_CMD|/reset_stats' }],
    [{ text: '📦 Show Pool Count', callback_data: 'OPEN_CMD|/show_pool_count' },
     { text: '🔄 Reload Pool', callback_data: 'OPEN_CMD|/reload_pool' }],
    [{ text: '🛑 Cancel Broadcast', callback_data: 'OPEN_CMD|/cancel_broadcast' },
     { text: '🧾 Status Broadcast', callback_data: 'OPEN_CMD|/status_broadcast' }],
    [{ text: '⬅️ Kembali ke Menu User', callback_data: 'OPEN_CMD|/menu' }]
  ]};
}
function adminMenuText(isAdmin) {
  const note = isAdmin ? '' : '\n\n🙏 *Mohon maaf, fitur ini hanya untuk admin.*';
  return ['*Menu Admin*',
          '• Broadcast teks/foto dengan preview.',
          '• Stats & tren 7 hari.',
          '• Kelola pool proxy.'
         ].join('\n') + note;
}

// ===== Country keyboard with paging =====
function buildCountryPage(page, pageSize) {
  const start = page*pageSize;
  const slice = COUNTRY_CATALOG.slice(start, start+pageSize);
  const rows = [];
  for (let i=0;i<slice.length;i+=3){
    const row = slice.slice(i,i+3).map(c => ({ text: `${c.flag} ${c.cc}`, callback_data: `CSEL|${c.cc}|${page}` }));
    rows.push(row);
  }
  const nav = [];
  if (start>0) nav.push({ text:'⬅️ Prev', callback_data:`CPAGE|${page-1}` });
  if (start+pageSize<COUNTRY_CATALOG.length) nav.push({ text:'Next ➡️', callback_data:`CPAGE|${page+1}` });
  nav.push({ text:'↩️ Back', callback_data:'OPEN_CMD|/menu' });
  rows.push(nav);
  return { inline_keyboard: rows };
}
function buildIPListKeyboard(cc, list){
  const rows = list.map(ip => [{ text: ip, callback_data: `PUSE|${cc}|${encodeURIComponent(ip)}` }]);
  rows.push([{ text:'↩️ Back', callback_data:`CPAGE|0` }]);
  return { inline_keyboard: rows };
}
function buildProtoKeyboard(ip, port){
  return { inline_keyboard: [
    [{ text:'⚡ VLESS', callback_data:`GEN|VLESS|${ip}|${port}` },
     { text:'🛡 TROJAN', callback_data:`GEN|TROJAN|${ip}|${port}` }],
    [{ text:'↩️ Back', callback_data:`OPEN_CMD|/proxyip` }]
  ]};
}
function buildWildcardKeyboard(s, proto, ip, port){
  const rows = [];
  for (const key of Object.keys(s.WILDCARD_MAP)) {
    const host = getWildcardHostByKey(s, key);
    rows.push([{ text: host, callback_data: `WSEL|${proto}|${ip}|${port}|${key}` }]);
  }
  rows.unshift([{ text:'🚫 Tanpa Wildcard', callback_data:`WSEL|${proto}|${ip}|${port}|__NONE__` }]);
  rows.push([{ text:'↩️ Back', callback_data:`GEN|${proto}|${ip}|${port}` }]);
  return { inline_keyboard: rows };
}

// ================== Speedtest ==================
async function speedtestCF(s) {
  const res = { ok: true, pings: [], pingAvg: null, pingMin: null, pingMax: null, downMbps: null };
  // Ping RTT ke Cloudflare anycast (1.1.1.1)
  for (let i=0;i<s.SPEED_PINGS;i++){
    const t0 = ts();
    try { await fetch('https://1.1.1.1/cdn-cgi/trace?ts='+t0, { method:'GET' }); }
    catch {}
    const t1 = ts(); res.pings.push(t1 - t0);
  }
  if (res.pings.length){
    res.pingMin = Math.min(...res.pings);
    res.pingMax = Math.max(...res.pings);
    res.pingAvg = Math.round(res.pings.reduce((a,b)=>a+b,0)/res.pings.length);
  }
  // Download throughput dari speed.cloudflare.com
  try {
    const bytes = s.SPEED_DL_BYTES;
    const t0 = ts();
    const r = await fetch('https://speed.cloudflare.com/__down?bytes='+bytes, { method:'GET' });
    // walau tidak dipakai, baca body agar transfer terjadi
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader();
      while (true) { const {done, value} = await reader.read(); if (done) break; /* discard */ }
    } else { await r.arrayBuffer(); }
    const t1 = ts();
    const sec = (t1 - t0)/1000;
    if (sec > 0) res.downMbps = Number(((bytes*8)/sec/1_000_000).toFixed(2));
  } catch { /* ignore */ }
  return res;
}

// ================== /proxyip helpers ==================
async function fetchMeta(s, ip, port){
  const r=await fetch(s.API_URL+encodeURIComponent(ip)+':'+encodeURIComponent(port));
  if(!r.ok) throw new Error('meta fail');
  return r.json();
}
async function findActiveIPsByCC(s, env, cc, want=5){
  const merged = await getMergedPool(s, env, {});
  const out = [];
  const flag = ccToFlag(cc);
  for (const raw of merged) {
    const {ip, port} = parseIPPort(raw);
    if (!isValidIP(ip) || !isValidPort(port)) continue;
    try {
      const m = await fetchMeta(s, ip, port);
      const hit = (m.flag && flag && m.flag===flag) || (m.country && new RegExp(`\\b${cc}\\b`, 'i').test(m.country));
      if (hit) {
        out.push(`${ip}:${port}`);
        if (out.length >= want) break;
      }
    } catch {}
    if (s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}

// ================== Worker ==================
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const s = buildSettings(env);
      const body = await request.json();

      // ----- callback handler -----
      if (body.callback_query) {
        const cb = body.callback_query;
        const chatId = String(cb.message?.chat?.id || '');
        const data = cb.data || '';

        if (data.startsWith('OPEN_CMD|')) {
          const cmd = data.slice(9);
          await answerCallbackQuery(s, cb.id, 'Menjalankan…');
          body.message = { chat:{ id: chatId, type: 'private' }, text: cmd, from: cb.from };
          delete body.callback_query;
        } else if (data.startsWith('CPAGE|')) {
          const page = Number(data.split('|')[1]||0);
          await answerCallbackQuery(s, cb.id);
          await editMessage(s, env, chatId, cb.message.message_id, '*🌍 Pilih negara:*', buildCountryPage(page, s.COUNTRY_PAGE_SIZE));
          return new Response('OK',{status:200});
        } else if (data.startsWith('CSEL|')) {
          await answerCallbackQuery(s, cb.id, 'Mencari IP aktif…');
          const [, cc, pageStr] = data.split('|'); const page = Number(pageStr||0);
          const list = await findActiveIPsByCC(s, env, cc, s.MAX_ACTIVE_IP_LIST);
          if (!list.length) {
            await editMessage(s, env, chatId, cb.message.message_id, `❌ Tidak menemukan IP aktif untuk ${ccToFlag(cc)} ${cc}. Coba halaman lain.`, buildCountryPage(page, s.COUNTRY_PAGE_SIZE));
          } else {
            await editMessage(s, env, chatId, cb.message.message_id, `✅ *IP aktif untuk* ${ccToFlag(cc)} *${cc}*:\nPilih salah satu:`, buildIPListKeyboard(cc, list));
          }
          return new Response('OK',{status:200});
        } else if (data.startsWith('PUSE|')) {
          await answerCallbackQuery(s, cb.id);
          const [, cc, enc] = data.split('|'); const ipport = decodeURIComponent(enc);
          const {ip, port} = parseIPPort(ipport);
          await editMessage(s, env, chatId, cb.message.message_id, `🔌 *Target:* \`${ip}:${port}\`\nPilih protokol:`, buildProtoKeyboard(ip, port));
          return new Response('OK',{status:200});
        } else if (data.startsWith('GEN|')) {
          await answerCallbackQuery(s, cb.id);
          const [, proto, ip, port] = data.split('|');
          await editMessage(s, env, chatId, cb.message.message_id, `🎛 *${proto}* untuk \`${ip}:${port}\`\nPilih wildcard:`, buildWildcardKeyboard(s, proto, ip, port));
          return new Response('OK',{status:200});
        } else if (data.startsWith('WSEL|')) {
          await answerCallbackQuery(s, cb.id, 'Membuat config…');
          const [, proto, ip, port, key] = data.split('|');
          const hostSNI = key==='__NONE__'
            ? (proto==='VLESS' ? s.SERVER_VLESS : s.SERVER_TROJAN)
            : getWildcardHostByKey(s, key);
          if (!hostSNI) {
            await sendMessage(s, env, chatId, '❌ Host SNI tidak ditemukan. Cek ENV.');
            return new Response('OK',{status:200});
          }
          try{
            const meta = await fetchMeta(s, ip, port);
            const tag = `${meta.isp || ip} ${meta.flag || ''}`.trim();
            const innerHost = meta.proxyHost || ip;
            const innerPort = meta.proxyPort || port;
            const linkTLS  = (proto==='VLESS') ? genVlessTLS(s, hostSNI, innerHost, innerPort, tag) : genTrojanTLS(s, hostSNI, innerHost, innerPort, tag);
            const linkNTLS = (proto==='VLESS') ? genVlessNTLS(s, hostSNI, innerHost, innerPort, tag) : genTrojanNTLS(s, hostSNI, innerHost, innerPort, tag);
            const header = buildConfigHeader(meta);
            await editMessage(s, env, chatId, cb.message.message_id,
              `✅ *Config ${proto}*\n${header}\n\n` +
              `🔒 *${proto} — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n` +
              `🔓 *${proto} — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\``);
          }catch{
            await sendMessage(s, env, chatId, `❌ Gagal ambil data IP ${ip}:${port}`);
          }
          return new Response('OK',{status:200});
        } else {
          await answerCallbackQuery(s, cb.id);
          return new Response('OK',{status:200});
        }
      }

      // ----- message handler -----
      if (body.message) {
        const msg = body.message;
        const chatId = String(msg.chat.id);
        const username = (msg.from?.username ? '@'+msg.from.username : (msg.from?.first_name || ''));
        const chatType = String(msg.chat?.type || 'private');
        const isAdmin = s.ADMIN_IDS.map(String).includes(chatId);

        await addSubscriber(env, chatId);
        await statsTrackMessage(env, chatId, username, chatType, 'message');
        await statsEnsureUserCount(env);

        const text = (msg.text || '').trim();

        if (text.toLowerCase().startsWith('/menu')) {
          await sendMessage(s, env, chatId, userMenuText(), buildUserMenuKeyboard());
          await statsPushCmd(env, 'menu');
          return new Response('OK',{status:200});
        }
        if (text.toLowerCase().startsWith('/admin')) {
          await sendMessage(s, env, chatId, adminMenuText(isAdmin), buildAdminMenuKeyboard());
          await statsPushCmd(env, 'admin');
          return new Response('OK',{status:200});
        }

        // NEW: /speedtest
        if (text.toLowerCase().startsWith('/speedtest')) {
          if (!(await rateCheck(env, s, chatId)) || !(await cooldownCheck(env, s, chatId, 'speedtest'))) {
            await sendMessage(s, env, chatId, '⏳ Terlalu cepat. Coba lagi sebentar lagi.'); 
            return new Response('OK',{status:200});
          }
          await sendMessage(s, env, chatId, '🚀 *Memulai speedtest Cloudflare...* (ping & unduh)');
          const r = await speedtestCF(s);
          const pingLine = (r.pingAvg!==null)
            ? `🏓 Ping — avg: *${r.pingAvg}* ms | min: ${r.pingMin} | max: ${r.pingMax} ms`
            : '🏓 Ping — (gagal diukur)';
          const downLine = (r.downMbps!==null)
            ? `⬇️ Download: *${r.downMbps}* Mbps (CF)`
            : '⬇️ Download: (gagal diukur)';
          await sendMessage(s, env, chatId, `*Hasil Speedtest*\n${pingLine}\n${downLine}`);
          return new Response('OK',{status:200});
        }

        // NEW: /bandwidth
        if (text.toLowerCase().startsWith('/bandwidth')) {
          const vals = await getTrafficLast7(env);
          const todayBytes = vals[vals.length-1] || 0;
          const total7 = vals.reduce((a,b)=>a+b,0);
          const bar = sparkline(vals);
          const daysLabel = lastNDaysKeysUTC(7).map(k => `${k.slice(4,6)}/${k.slice(6,8)}`).join('  ');
          const msgBW = [
            '*Penggunaan Bandwidth (payload -> Telegram API)*',
            `📅 Hari ini: *${bytesHuman(todayBytes)}*`,
            `🗓 7 hari: *${bytesHuman(total7)}*`,
            '',
            'Tren 7 hari:',
            '`'+bar+'`',
            daysLabel
          ].join('\n');
          await sendMessage(s, env, chatId, msgBW);
          return new Response('OK',{status:200});
        }

        // === /proxyip (country picker) ===
        if (text.toLowerCase().startsWith('/proxyip')) {
          if (!await rateCheck(env, s, chatId) || !await cooldownCheck(env, s, chatId, 'proxyip')) {
            await sendMessage(s, env, chatId, '⏳ Terlalu cepat. Coba lagi sebentar lagi.'); 
            return new Response('OK',{status:200});
          }
          await sendMessage(s, env, chatId, '*🌍 Pilih negara:*', buildCountryPage(0, s.COUNTRY_PAGE_SIZE));
          await statsPushCmd(env, 'proxyip');
          return new Response('OK',{status:200});
        }

        // === random_proxy cepat (tetap ada) ===
        if (text.startsWith('/random_proxy')) {
          const rawFilter = text.replace('/random_proxy','').trim();
          const filter = parseProxyFilter(rawFilter);
          const pick = await pickProxyByFilter(s, env, filter, { maxTries: 40 });
          if (!pick) {
            await sendMessage(s, env, chatId, '❌ Tidak menemukan proxy yang cocok.\nContoh: `/random_proxy isp:telkom id`');
          } else {
            const m = pick.meta || {};
            const flag = m.flag || '🏳️';
            const isp  = m.isp  || '(unknown ISP)';
            const ctry = m.country || '(unknown country)';
            const kb = { inline_keyboard: [[{ text: '🎲 Lagi (filter sama)', callback_data: 'OPEN_CMD|/random_proxy '+rawFilter }]] };
            await sendMessage(s, env, chatId,
              `🎲 *Random proxy*\n\`${pick.ip}:${pick.port}\`\n` +
              `👤 ISP: *${isp}*\n🌍 Country: *${ctry}* ${flag}`, kb);
          }
          return new Response('OK', { status: 200 });
        }

        // ... (perintah lain: random_config, wildcard, broadcast, stats, dst — tetap sama seperti versi sebelumnya, 
        //      dan pastikan panggilan sendMessage/editMessage/sendPhoto/sendDocumentFromText sekarang memakai "env")

        if (text.startsWith('/start')) {
          await sendMessage(s, env, chatId, 'Halo! Pakai /menu untuk tombol & contoh perintah.\nAdmin: gunakan /admin.');
          return new Response('OK',{status:200});
        }
        if (text) await sendMessage(s, env, chatId, 'Pesan diterima ✅');
        return new Response('OK',{status:200});
      }

      return new Response('OK',{status:200});
    } catch (err) {
      console.error(err);
      return new Response('Bad Request', { status: 400 });
    }
  }
};

// ================== Parsers/filters untuk /random_proxy ==================
function parseProxyFilter(text){
  const out={ cc:null, isp:null, countryLike:null };
  const parts=text.trim().split(/\s+/).filter(Boolean);
  for(const raw of parts){
    const s=raw.trim();
    if(/^isp:/i.test(s)) { out.isp=s.slice(4).trim().toLowerCase(); continue; }
    if(/^country:/i.test(s)) { out.countryLike=s.slice(8).trim().toLowerCase(); continue; }
    if(/^[A-Za-z]{2}$/.test(s)) { out.cc=s.toUpperCase(); continue; }
    const maybeCC=flagToCC(s); if(maybeCC){ out.cc=maybeCC; continue; }
  }
  return out;
}
async function pickProxyByFilter(s, env, filter, opts={}) {
  const merged = await getMergedPool(s, env, {});
  const list = merged.slice().sort(()=>Math.random()-0.5);
  const tries = Math.min(list.length, opts.maxTries || 40);
  for (let i=0;i<tries;i++){
    const raw=list[i]; const {ip,port}=parseIPPort(raw);
    if(!isValidIP(ip)||!isValidPort(port)) continue;
    try{
      const r=await fetch(s.API_URL + encodeURIComponent(ip)+':'+encodeURIComponent(port));
      if(!r.ok) continue;
      const j=await r.json();
      if (!filter || (!filter.cc && !filter.isp && !filter.countryLike) || metaMatchesFilter(j, filter)) {
        return { ip, port, meta:j };
      }
    }catch{}
    if (s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  return null;
}
function flagToCountryCode(flag){ const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length!==2) return null; const A=0x1F1E6; const c1=String.fromCharCode(0x41+(cps[0]-A)); const c2=String.fromCharCode(0x41+(cps[1]-A)); return /[A-Z]{2}/.test(c1+c2) ? c1+c2 : null; }
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
