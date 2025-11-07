import { KV } from './kv.js';
import { ts, sleep } from './utils.js';
import { KV_REMOTE_POOL } from './settings.js';

export function parsePoolText(text){ return text.split(/\r?\n|,/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')); }
export function parseIPPort(s){ const p=s.split(':'); return p.length===2?{ip:p[0],port:p[1]}:{ip:s,port:'443'}; }
export function ipValid(ip){ const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/; const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/; return v4.test(ip)||v6.test(ip); }
export function portValid(p){ const n=Number(p); return Number.isInteger(n)&&n>0&&n<=65535; }

async function fetchRemotePool(s){
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
    const now=ts();
    if(!refresh && cached && now-(cached.updatedAt||0)<s.PROXY_POOL_TTL*1000){
      remote=cached.list||[];
    }else{
      try{ remote=await fetchRemotePool(s); await KV.set(env,KV_REMOTE_POOL,{updatedAt:now,list:remote}); }
      catch{ remote=(cached?.list)||[]; }
    }
  }
  return Array.from(new Set([...local,...remote]));
                             }
