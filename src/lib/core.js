// ============ KV Keys ============
export const KV_SUBS = 'subs:list';
export const KV_REMOTE_POOL = 'pool:remote:v1';
export const KV_BCAST = 'bcast:cur';
export const KV_TRAFFIC_DAILY = 'traffic:daily:'; // +YYYYMMDD => { bytesOut }
export const KV_COUNTRY_CACHE = 'country:counts:v1'; // { updatedAt, ttlSec, list:[{cc,flag,count}] }
export const STATS_GLOBAL = 'stats:global';
export const STATS_DAILY_PREFIX = 'stats:daily:';
export const STATS_USER_PREFIX = 'stats:user:';
export const RL_BUCKET_PREFIX = 'rl:bucket:';
export const RL_COOLDOWN_PREFIX = 'rl:cooldown:';

// ============ SETTINGS ============
export function buildSettings(env){
  const num = (v,d)=>Number.isFinite(Number(v))?Number(v):d;
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

// ============ Utils ============
export const ts = ()=>Date.now();
export const sleep = ms=>new Promise(r=>setTimeout(r,ms));
export function todayKeyUTC(off=0){const d=new Date(); d.setUTCDate(d.getUTCDate()+off); const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}${m}${dd}`;}
export function lastNDaysKeys(n){ const out=[]; for(let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; }
export function bytesHuman(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>=100?0:x>=10?1:2)} ${u[i]}`;}
export function formatNowTZ(tz){ try{ return new Date().toLocaleString('id-ID',{ timeZone: tz, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }); }catch{ return new Date().toISOString(); } }
export function applyWatermark(text, s){ const wm=(s.ADMIN_WATERMARK||'').trim(); if(!wm) return text; return s.WATERMARK_POSITION==='top'?`${wm}\n${text}`:`${text}\n${wm}`; }
export function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65))+String.fromCodePoint(A+(c.charCodeAt(1)-65)); }

// ============ KV (BOT_DATA) ============
export const KV = {
  async get(env,key){ const raw=await env.BOT_DATA.get(key); if(!raw) return null; try{return JSON.parse(raw);}catch{return null;} },
  set(env,key,val){ return env.BOT_DATA.put(key, JSON.stringify(val)); },
  async list(env,prefix){ let cur; const keys=[]; while(true){const r=await env.BOT_DATA.list({prefix, cursor:cur}); keys.push(...r.keys.map(k=>k.name)); if(!r.list_complete&&r.cursor) cur=r.cursor; else break;} return keys; }
};

// ============ Stats / Users ============
export async function addSubscriber(env, id){ const set=new Set((await KV.get(env,KV_SUBS))||[]); set.add(String(id)); await KV.set(env,KV_SUBS,Array.from(set)); }
export async function trafficLast7(env){ const vals=await Promise.all(lastNDaysKeys(7).map(k=>KV.get(env,KV_TRAFFIC_DAILY+k))); return vals.map(v=>(v?.bytesOut)||0); }
export async function statsTrack(env, userId, username, chatType, cmd='message'){
  const day=STATS_DAILY_PREFIX+todayKeyUTC();
  const user=STATS_USER_PREFIX+userId;
  const g=(await KV.get(env,STATS_GLOBAL))||{totalMessages:0,totalUsers:0};
  g.totalMessages++; g.lastSeenAt=new Date().toISOString(); await KV.set(env,STATS_GLOBAL,g);
  const u=(await KV.get(env,user))||{messages:0,commands:{},firstSeenAt:new Date().toISOString()};
  u.messages++; u.username=username||u.username||''; u.lastSeenAt=new Date().toISOString(); u.commands[cmd]=(u.commands[cmd]||0)+1; await KV.set(env,user,u);
  const d=(await KV.get(env,day))||{messages:0,private:0,group:0};
  d.messages++; (chatType==='private'?d.private:d.group)++; await KV.set(env,day,d);
}
export async function ensureTotalUsers(env){ const set=new Set((await KV.get(env,KV_SUBS))||[]); const g=(await KV.get(env,STATS_GLOBAL))||{}; g.totalUsers=set.size; await KV.set(env,STATS_GLOBAL,g); }

// ============ Limiter ============
export async function rateCheck(env, s, uid){
  const key=RL_BUCKET_PREFIX+uid; const cap=s.LIMIT_BURST; const rate=s.LIMIT_MAX_PER_MIN/60; const now=ts();
  let b=(await KV.get(env,key))||{tokens:cap,updatedAt:now};
  const el=Math.max(0,(now-(b.updatedAt||now))/1000);
  b.tokens=Math.min(cap,(b.tokens||cap)+el*rate);
  if(b.tokens<1){ await KV.set(env,key,{tokens:b.tokens,updatedAt:now}); return false; }
  b.tokens-=1; b.updatedAt=now; await KV.set(env,key,b); return true;
}
export async function cooldown(env, s, uid, name){
  const key=RL_COOLDOWN_PREFIX+uid+':'+name; const now=ts(); const last=await KV.get(env,key);
  if(last && (now-last.when<s.CMD_COOLDOWN_MS)) return false; await KV.set(env,key,{when:now}); return true;
                                 }
