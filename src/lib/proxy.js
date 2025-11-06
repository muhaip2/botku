import { KV, KV_REMOTE_POOL, KV_COUNTRY_CACHE, sleep, ts, ccToFlag } from './core.js';

// parsing/validate
export function parseIPPort(s){ const p=s.split(':'); return p.length===2?{ip:p[0],port:p[1]}:{ip:s,port:'443'}; }
export function ipValid(ip){ const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/; const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/; return v4.test(ip)||v6.test(ip); }
export function portValid(p){ const n=Number(p); return Number.isInteger(n)&&n>0&&n<=65535; }

// meta
export async function fetchMeta(s, ip, port){ const r=await fetch(s.API_URL+encodeURIComponent(ip)+':'+encodeURIComponent(port)); if(!r.ok) throw new Error('meta fail'); return r.json(); }
export function headerFromMeta(m){ const flag=m.flag||'🏳️'; const country=m.country||'Unknown'; const isp=m.isp||'Unknown ISP'; const ms=(m.delay!=null)?`${m.delay} ms`:'-'; return `*${flag} ${country}* • *${isp}* • *${ms}*`; }

// pool merge
function parsePoolText(text){ return text.split(/\r?\n|,/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')); }
async function fetchRemotePool(s){ const r=await fetch(s.PROXY_POOL_URL); if(!r.ok) throw new Error('remote fail '+r.status); const ct=r.headers.get('content-type')||''; if(ct.includes('json')){ const j=await r.json(); if(Array.isArray(j)) return j.map(String); if(j&&Array.isArray(j.list)) return j.list.map(String); throw new Error('bad json'); } return parsePoolText(await r.text()); }
export async function mergedPool(s, env, {refresh=false}={}){
  const local=s.PROXY_POOL||[]; let remote=[];
  if(s.PROXY_POOL_URL){
    const cached=await KV.get(env,KV_REMOTE_POOL); const now=ts();
    if(!refresh && cached && now-(cached.updatedAt||0)<s.PROXY_POOL_TTL*1000){ remote=cached.list||[]; }
    else{
      try{ remote=await fetchRemotePool(s); await KV.set(env,KV_REMOTE_POOL,{updatedAt:now,list:remote}); }
      catch{ remote=(cached?.list)||[]; }
    }
  }
  return Array.from(new Set([...local,...remote]));
}

// generators
export function vlessTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`; }
export function vlessNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
export function trojanTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`; }
export function trojanNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
export function wildcardHostByKey(s,key){ const v=s.WILDCARD_MAP[key]; if(!v) return null; if(v.includes('.')) return v; if(!s.SERVER_WILDCARD) return null; return `${v}.${s.SERVER_WILDCARD}`; }

// countries cache
export async function getCountryCounts(s, env){
  const cache = await KV.get(env, KV_COUNTRY_CACHE);
  const now = ts();
  if (cache && now - (cache.updatedAt||0) < s.COUNTRY_CACHE_TTL*1000) return cache.list;

  const pool = await mergedPool(s, env, {});
  const map = new Map(); // cc -> {cc,flag,count}

  for (const raw of pool){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{
      const m=await fetchMeta(s, ip, port); const flag=m.flag||''; let cc='';
      if (flag) { const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length===2){ const A=0x1F1E6; cc=String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A)); } }
      if(!cc && m.country && m.country.length>=2) cc=(m.country.slice(0,2).toUpperCase()); if(!cc) continue;
      const cur=map.get(cc)||{cc,flag:flag||ccToFlag(cc),count:0}; cur.count++; map.set(cc,cur);
    }catch{}
    if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }

  let list=Array.from(map.values()).sort((a,b)=>b.count-a.count);
  if (s.COUNTRY_LIST_LIMIT>0) list=list.slice(0,s.COUNTRY_LIST_LIMIT);
  await KV.set(env, KV_COUNTRY_CACHE, { updatedAt: now, ttlSec: s.COUNTRY_CACHE_TTL, list });
  return list;
}

export async function countryActiveIPs(s, env, cc, want){
  const pool=await mergedPool(s,env,{}); const out=[]; const flag=ccToFlag(cc);
  for(const raw of pool){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{
      const m=await fetchMeta(s,ip,port);
      const match=(m.flag===flag) || (m.country && m.country.toUpperCase().startsWith(cc));
      if(match){ out.push(`${ip}:${port}`); if(out.length>=want) break; }
    }catch{}
    if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}

// random list
export async function randomProxyList(s, env, count){
  const pool=await mergedPool(s, env, {}); const shuffled=pool.slice().sort(()=>Math.random()-0.5);
  const out=[]; for (const raw of shuffled){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{ const m=await fetchMeta(s,ip,port); out.push({ip,port,meta:m}); }catch{}
    if(out.length>=count) break; if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}

// speedtest
export async function speedtestCF(s){
  const out={pings:[],avg:null,min:null,max:null,down:null};
  for(let i=0;i<s.SPEED_PINGS;i++){
    const t0=Date.now(); try{ await fetch('https://1.1.1.1/cdn-cgi/trace?ts='+t0);}catch{}
    out.pings.push(Date.now()-t0);
  }
  if(out.pings.length){
    out.min=Math.min(...out.pings); out.max=Math.max(...out.pings);
    out.avg=Math.round(out.pings.reduce((a,b)=>a+b,0)/out.pings.length);
  }
  try{
    const bytes=s.SPEED_DL_BYTES; const t0=Date.now();
    const r=await fetch('https://speed.cloudflare.com/__down?bytes='+bytes);
    if(r.body?.getReader){ const rd=r.body.getReader(); while(!(await rd.read()).done){} } else { await r.arrayBuffer(); }
    const sec=(Date.now()-t0)/1000; out.down = sec>0?Number(((bytes*8)/sec/1_000_000).toFixed(2)):null;
  }catch{}
  return out;
}

export const SPARK=['▁','▂','▃','▄','▅','▆','▇','█'];
export const spark=a=>{ if(!a.length) return '(no data)'; const mn=Math.min(...a), mx=Math.max(...a); if(mx===mn) return SPARK[0].repeat(a.length); return a.map(v=>SPARK[Math.floor((v-mn)/(mx-mn)*(SPARK.length-1))]).join(''); };
