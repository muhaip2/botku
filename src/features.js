import { KV } from './kv.js';
import { ts, sleep, todayKeyUTC, lastNDaysKeys, ccToFlag, spark } from './utils.js';
import { KV_SUBS, KV_BCAST, KV_COUNTRY_CACHE, STATS_GLOBAL, STATS_DAILY_PREFIX, STATS_USER_PREFIX, RL_BUCKET_PREFIX, RL_COOLDOWN_PREFIX } from './settings.js';
import { mergedPool, parseIPPort, ipValid, portValid } from './pool.js';
import { fetchMeta } from './meta.js';

// subscribers & stats
export async function addSubscriber(env, id){ const set=new Set((await KV.get(env,KV_SUBS))||[]); set.add(String(id)); await KV.set(env,KV_SUBS,Array.from(set)); }
export async function trafficLast7(env){ const keys=lastNDaysKeys(7).map(k=>'traffic:daily:'+k); const vals=await Promise.all(keys.map(k=>KV.get(env,k))); return vals.map(v=>(v?.bytesOut)||0); }
export async function statsTrack(env, userId, username, chatType, cmd='message'){
  const day=STATS_DAILY_PREFIX+todayKeyUTC(); const user=STATS_USER_PREFIX+userId;
  const g=(await KV.get(env,STATS_GLOBAL))||{totalMessages:0,totalUsers:0};
  g.totalMessages++; g.lastSeenAt=new Date().toISOString(); await KV.set(env,STATS_GLOBAL,g);
  const u=(await KV.get(env,user))||{messages:0,commands:{},firstSeenAt:new Date().toISOString()};
  u.messages++; u.username=username||u.username||''; u.lastSeenAt=new Date().toISOString(); u.commands[cmd]=(u.commands[cmd]||0)+1; await KV.set(env,user,u);
  const d=(await KV.get(env,day))||{messages:0,private:0,group:0}; d.messages++; (chatType==='private'?d.private:d.group)++; await KV.set(env,day,d);
}
export async function ensureTotalUsers(env){ const set=new Set((await KV.get(env,KV_SUBS))||[]); const g=(await KV.get(env,STATS_GLOBAL))||{}; g.totalUsers=set.size; await KV.set(env,STATS_GLOBAL,g); }

// limiter
export async function rateCheck(env, s, uid){
  const key=RL_BUCKET_PREFIX+uid; const cap=s.LIMIT_BURST; const rate=s.LIMIT_MAX_PER_MIN/60; const now=ts();
  let b=(await KV.get(env,key))||{tokens:cap,updatedAt:now}; const el=Math.max(0,(now-(b.updatedAt||now))/1000);
  b.tokens=Math.min(cap,(b.tokens||cap)+el*rate); if(b.tokens<1){ await KV.set(env,key,{tokens:b.tokens,updatedAt:now}); return false; }
  b.tokens-=1; b.updatedAt=now; await KV.set(env,key,b); return true;
}
export async function cooldown(env, s, uid, name){
  const key=RL_COOLDOWN_PREFIX+uid+':'+name; const now=ts(); const last=await KV.get(env,key);
  if(last && (now-last.when<s.CMD_COOLDOWN_MS)) return false; await KV.set(env,key,{when:now}); return true;
}

// cached country counts
export async function getCountryCounts(s, env){
  const cache=await KV.get(env,KV_COUNTRY_CACHE); const now=ts();
  if(cache && now-(cache.updatedAt||0)<s.COUNTRY_CACHE_TTL*1000) return cache.list;
  const pool=await mergedPool(s,env,{}); const map=new Map();
  for(const raw of pool){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{
      const m=await fetchMeta(s,ip,port); const flag=m.flag||''; let cc='';
      if(flag){ const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length===2){ const A=0x1F1E6; cc=String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A)); } }
      if(!cc && m.country && m.country.length>=2) cc=m.country.slice(0,2).toUpperCase(); if(!cc) continue;
      const cur=map.get(cc)||{cc,flag:flag||ccToFlag(cc),count:0}; cur.count++; map.set(cc,cur);
    }catch{}
    if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  let list=Array.from(map.values()).sort((a,b)=>b.count-a.count);
  if(s.COUNTRY_LIST_LIMIT>0) list=list.slice(0,s.COUNTRY_LIST_LIMIT);
  await KV.set(env,KV_COUNTRY_CACHE,{updatedAt:now,ttlSec:s.COUNTRY_CACHE_TTL,list});
  return list;
}

// random proxy pick
export async function randomProxyList(s, env, count){
  const pool=await mergedPool(s, env, {}); const shuffled=pool.slice().sort(()=>Math.random()-0.5);
  const out=[]; for(const raw of shuffled){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{ const m=await fetchMeta(s,ip,port); out.push({ip,port,meta:m}); }catch{}
    if(out.length>=count) break; if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}

// filter ip by country
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

// speedtest + sparkline
export async function speedtestCF(s){
  const out={pings:[],avg:null,min:null,max:null,down:null};
  for(let i=0;i<s.SPEED_PINGS;i++){ const t0=ts(); try{ await fetch('https://1.1.1.1/cdn-cgi/trace?ts='+t0);}catch{} const t1=ts(); out.pings.push(t1-t0); }
  if(out.pings.length){ out.min=Math.min(...out.pings); out.max=Math.max(...out.pings); out.avg=Math.round(out.pings.reduce((a,b)=>a+b,0)/out.pings.length); }
  try{ const bytes=s.SPEED_DL_BYTES; const t0=ts(); const r=await fetch('https://speed.cloudflare.com/__down?bytes='+bytes);
    if(r.body?.getReader){ const rd=r.body.getReader(); while(!(await rd.read()).done){} } else { await r.arrayBuffer(); }
    const sec=(ts()-t0)/1000; out.down = sec>0?Number(((bytes*8)/sec/1_000_000).toFixed(2)):null; }catch{}
  return out;
}

export { spark }; // biar bisa dipakai oleh bot.js
