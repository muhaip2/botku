
// ============ KV Keys ============
const KV_SUBS = 'subs:list';
const KV_REMOTE_POOL = 'pool:remote:v1';
const KV_BCAST = 'bcast:cur';
const KV_TRAFFIC_DAILY = 'traffic:daily:'; // +YYYYMMDD => { bytesOut }
const KV_COUNTRY_CACHE = 'country:counts:v1'; // { updatedAt, ttlSec, list:[{cc,flag,count}] }
const STATS_GLOBAL = 'stats:global';
const STATS_DAILY_PREFIX = 'stats:daily:';
const STATS_USER_PREFIX = 'stats:user:';
const RL_BUCKET_PREFIX = 'rl:bucket:';
const RL_COOLDOWN_PREFIX = 'rl:cooldown:';

// ============ SETTINGS ============
function buildSettings(env){
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
const ts = ()=>Date.now();
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
function todayKeyUTC(off=0){const d=new Date(); d.setUTCDate(d.getUTCDate()+off); const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}${m}${dd}`;}
function lastNDaysKeys(n){ const out=[]; for(let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; }
function bytesHuman(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>=100?0:x>=10?1:2)} ${u[i]}`;}
function formatNowTZ(tz){ try{ return new Date().toLocaleString('id-ID',{ timeZone: tz, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }); }catch{ return new Date().toISOString(); } }
function applyWatermark(text, s){ const wm=(s.ADMIN_WATERMARK||'').trim(); if(!wm) return text; return s.WATERMARK_POSITION==='top'?`${wm}\n${text}`:`${text}\n${wm}`; }
function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65))+String.fromCodePoint(A+(c.charCodeAt(1)-65)); }

// ============ KV (BOT_DATA) ============
const KV = { get: async (env,key)=>{const raw=await env.BOT_DATA.get(key); if(!raw) return null; try{return JSON.parse(raw);}catch{return null;}}, set: (env,key,val)=>env.BOT_DATA.put(key, JSON.stringify(val)), list: async(env,prefix)=>{let cur; const keys=[]; while(true){const r=await env.BOT_DATA.list({prefix, cursor:cur}); keys.push(...r.keys.map(k=>k.name)); if(!r.list_complete&&r.cursor) cur=r.cursor; else break;} return keys;} };

// ============ Telegram (hitung payload -> bandwidth) ============
async function trackTraffic(env, bytes){ const key=KV_TRAFFIC_DAILY+todayKeyUTC(); const cur=await KV.get(env,key)||{bytesOut:0}; cur.bytesOut=(cur.bytesOut||0)+Math.max(0, bytes|0); await KV.set(env,key,cur); }
async function sendMessage(s, env, chat_id, text, reply_markup=null){ const body={chat_id,text:applyWatermark(text,s),parse_mode:'Markdown',disable_web_page_preview:true}; if(reply_markup) body.reply_markup=reply_markup; const payload=JSON.stringify(body); await trackTraffic(env,payload.length); const r=await fetch(s.TELEGRAM_API_URL+'sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:payload}); return r.json().catch(()=>({})); }
async function editMessage(s, env, chat_id, message_id, text, reply_markup=null){ const body={chat_id,message_id,text:applyWatermark(text,s),parse_mode:'Markdown',disable_web_page_preview:true}; if(reply_markup) body.reply_markup=reply_markup; const payload=JSON.stringify(body); await trackTraffic(env,payload.length); const r=await fetch(s.TELEGRAM_API_URL+'editMessageText',{method:'POST',headers:{'Content-Type':'application/json'},body:payload}); return r.json().catch(()=>({})); }
async function answerCallback(s,id,text=null,show=false){ const body={callback_query_id:id}; if(text){body.text=text; body.show_alert=show;} await fetch(s.TELEGRAM_API_URL+'answerCallbackQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); }
async function sendPhoto(s, env, chat_id, photo, caption=''){ const body={chat_id,photo,caption:applyWatermark(caption||'',s),parse_mode:'Markdown'}; const payload=JSON.stringify(body); await trackTraffic(env,payload.length); const r=await fetch(s.TELEGRAM_API_URL+'sendPhoto',{method:'POST',headers:{'Content-Type':'application/json'},body:payload}); return r.json().catch(()=>({})); }

// ============ Stats / Users ============
async function addSubscriber(env, id){ const set=new Set((await KV.get(env,KV_SUBS))||[]); set.add(String(id)); await KV.set(env,KV_SUBS,Array.from(set)); }
async function trafficLast7(env){ const vals=await Promise.all(lastNDaysKeys(7).map(k=>KV.get(env,KV_TRAFFIC_DAILY+k))); return vals.map(v=>(v?.bytesOut)||0); }
async function statsTrack(env, userId, username, chatType, cmd='message'){ const day=STATS_DAILY_PREFIX+todayKeyUTC(); const user=STATS_USER_PREFIX+userId; const g=(await KV.get(env,STATS_GLOBAL))||{totalMessages:0,totalUsers:0}; g.totalMessages++; g.lastSeenAt=new Date().toISOString(); await KV.set(env,STATS_GLOBAL,g); const u=(await KV.get(env,user))||{messages:0,commands:{},firstSeenAt:new Date().toISOString()}; u.messages++; u.username=username||u.username||''; u.lastSeenAt=new Date().toISOString(); u.commands[cmd]=(u.commands[cmd]||0)+1; await KV.set(env,user,u); const d=(await KV.get(env,day))||{messages:0,private:0,group:0}; d.messages++; (chatType==='private'?d.private:d.group)++; await KV.set(env,day,d); }
async function ensureTotalUsers(env){ const set=new Set((await KV.get(env,KV_SUBS))||[]); const g=(await KV.get(env,STATS_GLOBAL))||{}; g.totalUsers=set.size; await KV.set(env,STATS_GLOBAL,g); }

// ============ Limiter ============
async function rateCheck(env, s, uid){ const key=RL_BUCKET_PREFIX+uid; const cap=s.LIMIT_BURST; const rate=s.LIMIT_MAX_PER_MIN/60; const now=ts(); let b=(await KV.get(env,key))||{tokens:cap,updatedAt:now}; const el=Math.max(0,(now-(b.updatedAt||now))/1000); b.tokens=Math.min(cap,(b.tokens||cap)+el*rate); if(b.tokens<1){ await KV.set(env,key,{tokens:b.tokens,updatedAt:now}); return false; } b.tokens-=1; b.updatedAt=now; await KV.set(env,key,b); return true; }
async function cooldown(env, s, uid, name){ const key=RL_COOLDOWN_PREFIX+uid+':'+name; const now=ts(); const last=await KV.get(env,key); if(last && (now-last.when<s.CMD_COOLDOWN_MS)) return false; await KV.set(env,key,{when:now}); return true; }

// ============ Helpers Pool ============
function parsePoolText(text){ return text.split(/\r?\n|,/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')); }
async function fetchRemotePool(s){ const r=await fetch(s.PROXY_POOL_URL); if(!r.ok) throw new Error('remote fail '+r.status); const ct=r.headers.get('content-type')||''; if(ct.includes('json')){ const j=await r.json(); if(Array.isArray(j)) return j.map(String); if(j&&Array.isArray(j.list)) return j.list.map(String); throw new Error('bad json'); } return parsePoolText(await r.text()); }
async function mergedPool(s, env, {refresh=false}={}){ const local=s.PROXY_POOL||[]; let remote=[]; if(s.PROXY_POOL_URL){ const cached=await KV.get(env,KV_REMOTE_POOL); const now=ts(); if(!refresh && cached && now-(cached.updatedAt||0)<s.PROXY_POOL_TTL*1000){ remote=cached.list||[]; }else{ try{ remote=await fetchRemotePool(s); await KV.set(env,KV_REMOTE_POOL,{updatedAt:now,list:remote}); }catch{ remote=(cached?.list)||[]; } } } return Array.from(new Set([...local,...remote])); }
function parseIPPort(s){ const p=s.split(':'); return p.length===2?{ip:p[0],port:p[1]}:{ip:s,port:'443'}; }
function ipValid(ip){ const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/; const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/; return v4.test(ip)||v6.test(ip); }
function portValid(p){ const n=Number(p); return Number.isInteger(n)&&n>0&&n<=65535; }

// ============ Meta API ============
async function fetchMeta(s, ip, port){ const r=await fetch(s.API_URL+encodeURIComponent(ip)+':'+encodeURIComponent(port)); if(!r.ok) throw new Error('meta fail'); return r.json(); }
function headerFromMeta(m){ const flag=m.flag||'🏳️'; const country=m.country||'Unknown'; const isp=m.isp||'Unknown ISP'; const ms=(m.delay!=null)?`${m.delay} ms`:'-'; return `*${flag} ${country}* • *${isp}* • *${ms}*`; }

// ============ Generators ============
function vlessTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`; }
function vlessNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
function trojanTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`; }
function trojanNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
function wildcardHostByKey(s,key){ const v=s.WILDCARD_MAP[key]; if(!v) return null; if(v.includes('.')) return v; if(!s.SERVER_WILDCARD) return null; return `${v}.${s.SERVER_WILDCARD}`; }

// ============ Speedtest/Bandwidth ============
async function speedtestCF(s){ const out={pings:[],avg:null,min:null,max:null,down:null}; for(let i=0;i<s.SPEED_PINGS;i++){ const t0=ts(); try{ await fetch('https://1.1.1.1/cdn-cgi/trace?ts='+t0);}catch{} const t1=ts(); out.pings.push(t1-t0); } if(out.pings.length){ out.min=Math.min(...out.pings); out.max=Math.max(...out.pings); out.avg=Math.round(out.pings.reduce((a,b)=>a+b,0)/out.pings.length); } try{ const bytes=s.SPEED_DL_BYTES; const t0=ts(); const r=await fetch('https://speed.cloudflare.com/__down?bytes='+bytes); if(r.body?.getReader){ const rd=r.body.getReader(); while(!(await rd.read()).done){} } else { await r.arrayBuffer(); } const sec=(ts()-t0)/1000; out.down = sec>0?Number(((bytes*8)/sec/1_000_000).toFixed(2)):null; }catch{} return out; }
const SPARK=['▁','▂','▃','▄','▅','▆','▇','█']; const spark=a=>{ if(!a.length) return '(no data)'; const mn=Math.min(...a), mx=Math.max(...a); if(mx===mn) return SPARK[0].repeat(a.length); return a.map(v=>SPARK[Math.floor((v-mn)/(mx-mn)*(SPARK.length-1))]).join(''); };

// ============ Keyboards ============
const K_MAIN = { inline_keyboard:[ [{text:'📱 Menu User', callback_data:'OPEN_CMD|/menu_user'}], [{text:'⚙️ Menu Admin', callback_data:'OPEN_CMD|/menu_admin'}] ] };
function K_USER(){ return { inline_keyboard:[
  [{text:'🎲 Random Proxy', callback_data:'OPEN_CMD|/random_proxy'}],
  [{text:'🌍 Proxy per Negara', callback_data:'OPEN_CMD|/proxyip'}],
  [{text:'🚀 Speedtest', callback_data:'OPEN_CMD|/speedtest'},{text:'📶 Bandwidth', callback_data:'OPEN_CMD|/bandwidth'}],
  [{text:'📦 Show Pool Count', callback_data:'OPEN_CMD|/show_pool_count'}],
  [{text:'⬅️ Kembali', callback_data:'OPEN_CMD|/menu'}]
]}; }
function K_ADMIN(){ return { inline_keyboard:[
  [{text:'📝 Preview Broadcast', callback_data:'OPEN_CMD|/broadcast Halo semua!'}],
  [{text:'📷 Mode Foto Galeri', callback_data:'OPEN_CMD|/broadcast_img'}],
  [{text:'📊 Stats', callback_data:'OPEN_CMD|/stats'},{text:'♻️ Reset Stats', callback_data:'OPEN_CMD|/reset_stats'}],
  [{text:'📦 Show Pool Count', callback_data:'OPEN_CMD|/show_pool_count'},{text:'🔄 Reload Pool', callback_data:'OPEN_CMD|/reload_pool'}],
  [{text:'🛑 Cancel Broadcast', callback_data:'OPEN_CMD|/cancel_broadcast'},{text:'🧾 Status Broadcast', callback_data:'OPEN_CMD|/status_broadcast'}],
  [{text:'🚀 Speedtest', callback_data:'OPEN_CMD|/speedtest'},{text:'📶 Bandwidth', callback_data:'OPEN_CMD|/bandwidth'}],
  [{text:'⬅️ Kembali ke Menu User', callback_data:'OPEN_CMD|/menu_user'}]
]}; }

// Country list with counts
function K_countryList(list, page, pageSize){
  const start=page*pageSize; const slice=list.slice(start, start+pageSize);
  const rows = slice.map(c=>[{ text:`${c.flag} ${c.cc} (${c.count})`, callback_data:`CSEL|${c.cc}|${page}` }]);
  const nav=[]; if(start>0) nav.push({text:'⬅️ Prev', callback_data:`CPAGE|${page-1}`}); if(start+pageSize<list.length) nav.push({text:'Next ➡️', callback_data:`CPAGE|${page+1}`}); nav.push({text:'↩️ Back', callback_data:'OPEN_CMD|/menu_user'});
  rows.push(nav); return { inline_keyboard: rows };
}
function K_ipList(cc, ips){ const rows=ips.map(ip=>[{text:ip, callback_data:`PUSE|${cc}|${encodeURIComponent(ip)}`}]); rows.push([{text:'↩️ Back', callback_data:'OPEN_CMD|/proxyip'}]); return { inline_keyboard: rows }; }
function K_proto(ip,port){ return { inline_keyboard:[
  [{text:'⚡ VLESS', callback_data:`GEN|VLESS|${ip}|${port}`} ,{text:'🛡 TROJAN', callback_data:`GEN|TROJAN|${ip}|${port}`}],
  [{text:'↩️ Back', callback_data:'OPEN_CMD|/proxyip'}]
]}; }
function K_wildcard(s, proto, ip, port){ const rows=[[{text:'🚫 Tanpa Wildcard', callback_data:`WSEL|${proto}|${ip}|${port}|__NONE__`}]]; for(const k of Object.keys(s.WILDCARD_MAP)){ const host=wildcardHostByKey(s,k); rows.push([{text:host, callback_data:`WSEL|${proto}|${ip}|${port}|${k}`}]); } rows.push([{text:'↩️ Back', callback_data:`GEN|${proto}|${ip}|${port}`}]); return { inline_keyboard: rows }; }

// ============ Country counts cache ============
async function getCountryCounts(s, env){
  const cache = await KV.get(env, KV_COUNTRY_CACHE);
  const now = ts();
  if (cache && now - (cache.updatedAt||0) < s.COUNTRY_CACHE_TTL*1000) return cache.list;
  const pool = await mergedPool(s, env, {});
  const map = new Map(); // cc -> {cc,flag,count}
  for (const raw of pool){
    const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue;
    try{ const m=await fetchMeta(s, ip, port); const flag=m.flag||''; let cc=''; if (flag) { const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length===2){ const A=0x1F1E6; cc=String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A)); } }
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

// ============ Random proxy (10 items) ============
async function randomProxyList(s, env, count){
  const pool=await mergedPool(s, env, {}); const shuffled=pool.slice().sort(()=>Math.random()-0.5);
  const out=[]; for (const raw of shuffled){ const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue; try{ const m=await fetchMeta(s,ip,port); out.push({ip,port,meta:m}); }catch{} if(out.length>=count) break; if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS); }
  return out;
}

// ============ Worker ============
export default {
  async fetch(request, env){
    try{
      const url=new URL(request.url);
      if(url.pathname!=='/webhook') return new Response('Not Found',{status:404});
      if(request.method!=='POST') return new Response('Method Not Allowed',{status:405});
      const s=buildSettings(env);
      const body=await request.json();

      // CALLBACK
      if(body.callback_query){
        const cb=body.callback_query; const chatId=String(cb.message?.chat?.id||''); const data=cb.data||'';
        if(data.startsWith('OPEN_CMD|')){ const cmd=data.slice(9); await answerCallback(s,cb.id,'OK'); body.message={ chat:{id:chatId,type:'private'}, text:cmd, from:cb.from }; delete body.callback_query; }
        else if(data.startsWith('CPAGE|')){ const page=Number(data.split('|')[1]||0); const list=await getCountryCounts(s,env); await answerCallback(s,cb.id); await editMessage(s,env,chatId,cb.message.message_id,'*🌍 Pilih negara (cached 10 menit):*', K_countryList(list,page,s.COUNTRY_PAGE_SIZE)); return new Response('OK',{status:200}); }
        else if(data.startsWith('CSEL|')){ const [,cc,pageStr]=data.split('|'); const list=await countryActiveIPs(s,env,cc,s.MAX_ACTIVE_IP_LIST); await answerCallback(s,cb.id); if(!list.length){ await editMessage(s,env,chatId,cb.message.message_id,`❌ Tidak ada IP aktif untuk ${ccToFlag(cc)} *${cc}*.\nCoba negara lain.`, K_countryList(await getCountryCounts(s,env), Number(pageStr||0), s.COUNTRY_PAGE_SIZE)); } else { await editMessage(s,env,chatId,cb.message.message_id,`✅ *IP aktif untuk* ${ccToFlag(cc)} *${cc}*:\nPilih salah satu:`, K_ipList(cc,list)); } return new Response('OK',{status:200}); }
        else if(data.startsWith('PUSE|')){ const [,cc,enc]=data.split('|'); const ipport=decodeURIComponent(enc); const {ip,port}=parseIPPort(ipport); await answerCallback(s,cb.id); await editMessage(s,env,chatId,cb.message.message_id,`🔌 *Target:* \`${ip}:${port}\`\nPilih protokol:`, K_proto(ip,port)); return new Response('OK',{status:200}); }
        else if(data.startsWith('GEN|')){ const [,proto,ip,port]=data.split('|'); await answerCallback(s,cb.id); await editMessage(s,env,chatId,cb.message.message_id,`🎛 *${proto}* untuk \`${ip}:${port}\`\nPilih wildcard:`, K_wildcard(s,proto,ip,port)); return new Response('OK',{status:200}); }
        else if(data.startsWith('WSEL|')){ const [,proto,ip,port,key]=data.split('|'); await answerCallback(s,cb.id,'Membuat...'); const host=key==='__NONE__'?(proto==='VLESS'?s.SERVER_VLESS:s.SERVER_TROJAN):wildcardHostByKey(s,key); if(!host){ await sendMessage(s,env,chatId,'❌ Host SNI tidak ditemukan pada ENV.'); return new Response('OK',{status:200}); } try{ const m=await fetchMeta(s,ip,port); const tag=`${m.isp||ip} ${m.flag||''}`.trim(); const innerHost=m.proxyHost||ip; const innerPort=m.proxyPort||port; const linkTLS= proto==='VLESS'?vlessTLS(s,host,innerHost,innerPort,tag):trojanTLS(s,host,innerHost,innerPort,tag); const linkNTLS=proto==='VLESS'?vlessNTLS(s,host,innerHost,innerPort,tag):trojanNTLS(s,host,innerHost,innerPort,tag); await editMessage(s,env,chatId,cb.message.message_id,`✅ *Config ${proto}*\n${headerFromMeta(m)}\n\n🔒 *${proto} — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n🔓 *${proto} — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\``); }catch{ await sendMessage(s,env,chatId,`❌ Gagal ambil data IP ${ip}:${port}`);} return new Response('OK',{status:200}); }
        else { await answerCallback(s,cb.id); return new Response('OK',{status:200}); }
      }

      // MESSAGE
      if(body.message){
        const msg=body.message; const chatId=String(msg.chat.id); const chatType=String(msg.chat.type||'private'); const firstName=(msg.from?.first_name)||''; const username=msg.from?.username?('@'+msg.from.username):''; const isAdmin=s.ADMIN_IDS.map(String).includes(chatId);

        await addSubscriber(env, chatId);
        await statsTrack(env, chatId, username, chatType, 'message'); await ensureTotalUsers(env);

        const text=(msg.text||'').trim();

        // /start or /menu
        if(text.startsWith('/start') || text.startsWith('/menu')){
          const hello = `Halo *${firstName}*, aku adalah asisten pribadimu.\nTolong rawat aku ya seperti kamu merawat diri sendiri 😘\n\n👤 Nama: *${firstName}* ${username?`(${username})`:''}\n🆔 ID: \`${chatId}\`\n🕒 Waktu: _${formatNowTZ(s.TIMEZONE)}_`;
          await sendMessage(s, env, chatId, hello, K_MAIN);
          return new Response('OK',{status:200});
        }

        // menu_user
        if(text.startsWith('/menu_user')){
          await sendMessage(s, env, chatId, '*Menu User*', K_USER());
          return new Response('OK',{status:200});
        }

        // menu_admin
        if(text.startsWith('/menu_admin')){
          if(!isAdmin){ await sendMessage(s, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); }
          await sendMessage(s, env, chatId, '*Menu Admin*\n• Broadcast teks/foto (galeri) dengan preview.\n• Stats & tren 7 hari.\n• Kelola pool proxy.', K_ADMIN());
          return new Response('OK',{status:200});
        }

        // Random proxy (10 items with meta)
        if(text.startsWith('/random_proxy')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'random_proxy'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          const list = await randomProxyList(s, env, s.RANDOM_PROXY_COUNT);
          if(!list.length){ await sendMessage(s, env, chatId, '❌ Tidak ada proxy valid.'); return new Response('OK',{status:200}); }
          const lines = list.map((x,i)=>{ const m=x.meta||{}; const flag=m.flag||'🏳️'; const isp=m.isp||'-'; const country=m.country||'-'; const ms=(m.delay!=null)?`${m.delay} ms`:'-'; return `${i+1}. ${flag} \`${x.ip}:${x.port}\` — *${isp}* • ${country} • ${ms}`; });
          await sendMessage(s, env, chatId, `🎲 *Random Proxy (Top ${lines.length})*\n`+lines.join('\n'));
          return new Response('OK',{status:200});
        }

        // Proxy per negara
        if(text.startsWith('/proxyip')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'proxyip'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          const list=await getCountryCounts(s,env);
          await sendMessage(s, env, chatId, '*🌍 Pilih negara (cached 10 menit):*', K_countryList(list,0,s.COUNTRY_PAGE_SIZE));
          return new Response('OK',{status:200});
        }

        // Speedtest
        if(text.startsWith('/speedtest')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'speedtest'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          await sendMessage(s,env,chatId,'🚀 *Memulai speedtest Cloudflare...*');
          const r=await speedtestCF(s);
          const ping = r.avg!=null ? `🏓 Ping: *${r.avg}* ms (min ${r.min}, max ${r.max})` : '🏓 Ping: (gagal)';
          const down = r.down!=null ? `⬇️ Download: *${r.down}* Mbps` : '⬇️ Download: (gagal)';
          await sendMessage(s,env,chatId,`*Hasil Speedtest*\n${ping}\n${down}`);
          return new Response('OK',{status:200});
        }

        // Bandwidth
        if(text.startsWith('/bandwidth')){
          const vals=await trafficLast7(env); const today=vals[vals.length-1]||0; const total=vals.reduce((a,b)=>a+b,0);
          const chart=spark(vals); const labels=lastNDaysKeys(7).map(k=>`${k.slice(4,6)}/${k.slice(6,8)}`).join('  ');
          await sendMessage(s,env,chatId, `*Penggunaan Bandwidth (payload Telegram)*\n📅 Hari ini: *${bytesHuman(today)}*\n🗓 7 hari: *${bytesHuman(total)}*\n\n\`${chart}\`\n${labels}`);
          return new Response('OK',{status:200});
        }

        // Pool & admin utilities (ringkas)
        if(text.startsWith('/show_pool_count')){ const pool=await mergedPool(s,env,{}); await sendMessage(s,env,chatId,`📦 Total entri pool: *${pool.length}*`); return new Response('OK',{status:200}); }
        if(text.startsWith('/reload_pool')){ const pool=await mergedPool(s,env,{refresh:true}); await sendMessage(s,env,chatId,`🔄 Pool dimuat ulang: *${pool.length}* entri.`); return new Response('OK',{status:200}); }

        // Broadcast (preview -> confirm/cancel)
        if(text.startsWith('/broadcast_img')){ if(!isAdmin) { await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } await KV.set(env,KV_BCAST,{mode:'photo_wait',by:chatId}); await sendMessage(s,env,chatId,'📷 Kirim *foto dari galeri* sekarang (caption opsional).'); return new Response('OK',{status:200}); }
        if(text.startsWith('/broadcast')){ if(!isAdmin){ await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } const payload=text.replace('/broadcast','').trim()||'Contoh broadcast'; await KV.set(env,KV_BCAST,{mode:'text_preview',text:payload,by:chatId}); const kb={ inline_keyboard:[ [{text:'✅ Kirim',callback_data:'OPEN_CMD|/confirm_broadcast'}, {text:'❌ Batal', callback_data:'OPEN_CMD|/cancel_broadcast'} ] ] }; await sendMessage(s,env,chatId,`📝 *Preview Broadcast:*\n${payload}`,kb); return new Response('OK',{status:200}); }
        if(text.startsWith('/cancel_broadcast')){ await KV.set(env,KV_BCAST,null); await sendMessage(s,env,chatId,'🛑 Broadcast dibatalkan.'); return new Response('OK',{status:200}); }
        if(text.startsWith('/status_broadcast')){ const st=await KV.get(env,KV_BCAST); await sendMessage(s,env,chatId,'🧾 Status broadcast:\n'+('```json\n'+JSON.stringify(st||{},null,2)+'\n```')); return new Response('OK',{status:200}); }
        if(text.startsWith('/confirm_broadcast')){ if(!isAdmin){ await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } const st=await KV.get(env,KV_BCAST); if(!st){ await sendMessage(s,env,chatId,'Tidak ada broadcast aktif.'); return new Response('OK',{status:200}); } const subs=new Set((await KV.get(env,KV_SUBS))||[]); let ok=0; if(st.mode==='text_preview'){ for(const uid of subs){ try{ await sendMessage(s,env,uid,st.text); ok++; }catch{} await sleep(25); } } await KV.set(env,KV_BCAST,null); await sendMessage(s,env,chatId,`📤 Broadcast terkirim ke *${ok}* pengguna.`); return new Response('OK',{status:200}); }

        // Stats (ringkas)
        if(text.startsWith('/stats')){ const g=(await KV.get(env,STATS_GLOBAL))||{}; const vals=await trafficLast7(env); const chart=spark(vals); await sendMessage(s,env,chatId,`*Stats*\n👥 Users: *${g.totalUsers||0}*\n💬 Messages: *${g.totalMessages||0}*\n\n\`${chart}\``); return new Response('OK',{status:200}); }
        if(text.startsWith('/reset_stats')){ await KV.set(env,STATS_GLOBAL,{totalMessages:0,totalUsers:(await KV.get(env,KV_SUBS)||[]).length}); await sendMessage(s,env,chatId,'♻️ Stats direset.'); return new Response('OK',{status:200}); }

        // Fallback
        if(text){ await sendMessage(s,env,chatId,'Pesan diterima ✅'); }
        return new Response('OK',{status:200});
      }

      return new Response('OK',{status:200});
    }catch(e){ console.error(e); return new Response('Bad Request',{status:400}); }
  }
};

// ============ Extra helpers ============
async function countryActiveIPs(s, env, cc, want){
  const pool=await mergedPool(s,env,{}); const out=[]; const flag=ccToFlag(cc);
  for(const raw of pool){ const {ip,port}=parseIPPort(raw); if(!ipValid(ip)||!portValid(port)) continue; try{ const m=await fetchMeta(s,ip,port); const match=(m.flag===flag) || (m.country && m.country.toUpperCase().startsWith(cc)); if(match){ out.push(`${ip}:${port}`); if(out.length>=want) break; } }catch{} if(s.REQ_DELAY_MS>0) await sleep(s.REQ_DELAY_MS); }
  return out;
}
