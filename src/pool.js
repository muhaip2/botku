// src/pool.js
import { KV } from './kv.js';
import { fetchMeta } from './meta.js';

export const KV_REMOTE_POOL   = 'pool:remote:v1';
export const KV_COUNTRY_CACHE = 'country:counts:v1';
export const KV_ACTIVE_CC     = (cc)=>`cc:${cc}:ips:v1`;

const ts = ()=>Date.now();

export function parsePoolText(text){
  return text.split(/\r?\n|,/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#'));
}
export function parseIPPort(s){ const p=s.split(':'); return p.length===2?{ip:p[0],port:p[1]}:{ip:s,port:'443'}; }
export function ipValid(ip){
  const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/; return v4.test(ip)||v6.test(ip);
}
export function portValid(p){ const n=Number(p); return Number.isInteger(n)&&n>0&&n<=65535; }
export function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65))+String.fromCodePoint(A+(c.charCodeAt(1)-65)); }

async function fetchRemotePool(s){
  if(!s.PROXY_POOL_URL) return [];
  const r=await fetch(s.PROXY_POOL_URL);
  if(!r.ok) throw new Error('remote fail '+r.status);
  const ct=r.headers.get('content-type')||'';
  if(ct.includes('json')){
    const j=await r.json();
    if(Array.isArray(j)) return j.map(String);
    if(j&&Array.isArray(j.list)) return j.list.map(String);
    throw new Error('bad json');
  }
  return parsePoolText(await r.text());
}

export async function mergedPool(s, env, {refresh=false}={}){
  const local=s.PROXY_POOL||[];
  let remote=[];
  if(s.PROXY_POOL_URL){
    const cached=await KV.get(env,KV_REMOTE_POOL);
    const fresh = cached && (ts()-(cached.updatedAt||0) < s.PROXY_POOL_TTL*1000);
    if(!refresh && fresh){
      remote=cached.list||[];
    }else{
      try{
        remote=await fetchRemotePool(s);
        await KV.set(env,KV_REMOTE_POOL,{updatedAt:ts(),list:remote});
      }catch{
        remote=(cached?.list)||[];
      }
    }
  }
  return Array.from(new Set([...local,...remote]));
}

/* ---------------- Fast cache-first country list ---------------- */

export async function getCountryCountsCached(env){
  const c = await KV.get(env, KV_COUNTRY_CACHE);
  return c?.list || null;
}

function countryCodeFromMeta(m){
  if(m.flag){
    const cps=[...m.flag].map(c=>c.codePointAt(0));
    if(cps.length===2){ const A=0x1F1E6; 
      return String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A));
    }
  }
  if(m.country && m.country.length>=2) return m.country.slice(0,2).toUpperCase();
  return '';
}

async function mapConcurrent(items, limit, iter){
  const ret=[]; let idx=0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async ()=>{
    while(idx<items.length){
      const i=idx++; 
      try{ ret[i]=await iter(items[i], i); }catch{ ret[i]=null; }
    }
  });
  await Promise.all(workers);
  return ret;
}

export async function refreshCountryCounts(s, env){
  const poolFull = await mergedPool(s, env, {});
  const pool = poolFull.slice(0, s.SCAN_LIMIT);               // batasi jumlah yang discan

  const map = new Map(); // cc -> {cc, flag, count}
  await mapConcurrent(pool, s.CONCURRENCY, async (raw)=>{
    const {ip,port}=parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return;
    let m;
    try{ m = await fetchMeta(s, ip, port); }catch{ return; }
    const cc = countryCodeFromMeta(m);
    if(!cc) return;
    const flag = m.flag || ccToFlag(cc);
    const cur = map.get(cc) || { cc, flag, count:0 };
    cur.count++; map.set(cc, cur);
  });

  let list = Array.from(map.values()).sort((a,b)=>b.count-a.count);
  if(s.COUNTRY_LIST_LIMIT>0) list = list.slice(0, s.COUNTRY_LIST_LIMIT);

  const payload = { updatedAt: ts(), ttlSec: s.COUNTRY_CACHE_TTL, list };
  await KV.set(env, KV_COUNTRY_CACHE, payload);
  return list;
}

/* ---------------- Support for IPs per country & random list ---- */

export async function countryActiveIPs(s, env, cc, want){
  // cache per negara
  const key = KV_ACTIVE_CC(cc);
  const cached = await KV.get(env, key);
  if(cached && (ts()-(cached.updatedAt||0) < s.ACTIVE_IPS_TTL*1000))
    return cached.list;

  const pool = await mergedPool(s, env, {});
  const flag = ccToFlag(cc);
  const out = [];

  await mapConcurrent(pool, s.CONCURRENCY, async (raw)=>{
    if(out.length>=want) return; // short-circuit soft
    const {ip,port}=parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return;
    try{
      const m=await fetchMeta(s,ip,port);
      const match=(m.flag===flag) || (m.country && m.country.toUpperCase().startsWith(cc));
      if(match && out.length<want) out.push(`${ip}:${port}`);
    }catch{}
  });

  await KV.set(env, key, { updatedAt: ts(), list: out });
  return out;
}

export async function randomProxyList(s, env, count){
  const pool=await mergedPool(s, env, {});
  const shuffled=pool.slice(0, s.SCAN_LIMIT).sort(()=>Math.random()-0.5).slice(0, s.SCAN_LIMIT);
  const out=[];
  await mapConcurrent(shuffled, s.CONCURRENCY, async (raw)=>{
    if(out.length>=count) return;
    const {ip,port}=parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return;
    try{
      const m=await fetchMeta(s,ip,port);
      if(out.length<count) out.push({ip,port,meta:m});
    }catch{}
  });
  return out.slice(0, count);
     }                             }
