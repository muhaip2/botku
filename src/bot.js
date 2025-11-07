/* eslint-disable */
//
// Telegram CF Bot – versi cepat /proxyip (cache KV + paralel + timeout)
// Compatible: Cloudflare Pages Functions & Workers
//

// ========== Const Keys ==========
const KV_SUBS = 'subs:list';
const KV_REMOTE_POOL = 'pool:remote:v1';
const KV_TRAFFIC_DAILY = 'traffic:daily:'; // +YYYYMMDD => { bytesOut }
const KV_COUNTRY_COUNTS = 'country:counts:v1';              // cache list negara
const KV_COUNTRY_IPS = (cc)=>`country:ips:${cc}`;           // cache ip per-negara

// ========== Settings ==========
function buildSettings(env){
  const num = (v,d)=>Number.isFinite(Number(v))?Number(v):d;
  const bool=(v,d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());

  // Wildcard map default (boleh override via JSON)
  let WILDCARD_MAP = { cache:"cache.netflix.com", quiz:"quiz.vidio.com", support:"support.zoom.us" };
  if (env.WILDCARD_MAP_JSON) { try{ const j=JSON.parse(env.WILDCARD_MAP_JSON); if(j&&typeof j==='object') WILDCARD_MAP=j; }catch{} }

  return {
    // API
    TELEGRAM_API_URL: env.TELEGRAM_API_URL || '',
    META_API: env.API_URL || '',

    // SNI servers
    SERVER_WILDCARD: env.SERVER_WILDCARD || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    PASSUUID: env.PASSUUID || '',

    // UI/Admin
    ADMIN_IDS: (env.ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(Boolean),
    ADMIN_WATERMARK: env.ADMIN_WATERMARK || "────────────────────\n👤 Admin: @SWDSTORE\n📎 t.me/SWDSTORE",
    WATERMARK_POSITION: (env.WATERMARK_POSITION||'bottom').toLowerCase()==='top'?'top':'bottom',
    TIMEZONE: env.TIMEZONE || 'Asia/Jakarta',

    // Pool
    PROXY_POOL: (env.PROXY_POOL||'').split(',').map(s=>s.trim()).filter(Boolean),
    PROXY_POOL_URL: env.PROXY_POOL_URL || '',
    PROXY_POOL_TTL: num(env.PROXY_POOL_TTL, 900),

    // UX
    COUNTRY_PAGE_SIZE: num(env.COUNTRY_PAGE_SIZE, 18),
    RANDOM_PROXY_COUNT: num(env.RANDOM_PROXY_COUNT, 10),

    // Cache/Speed
    COUNTRY_CACHE_TTL: num(env.COUNTRY_CACHE_TTL, 600),
    ACTIVE_IPS_TTL: num(env.ACTIVE_IPS_TTL, 180),
    META_TIMEOUT_MS: num(env.META_TIMEOUT_MS, 2500),
    CONCURRENCY: num(env.CONCURRENCY, 8),
    SCAN_LIMIT: num(env.SCAN_LIMIT, 1200),

    // Wildcard
    WILDCARD_MAP
  };
}

// ========== Utils ==========
const ts = ()=>Date.now();
function todayKeyUTC(off=0){const d=new Date(); d.setUTCDate(d.getUTCDate()+off); const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}${m}${dd}`;}
function lastNDaysKeys(n){ const out=[]; for(let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; }
function bytesHuman(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>=100?0:x>=10?1:2)} ${u[i]}`;}
function formatNowTZ(tz){ try{ return new Date().toLocaleString('id-ID',{ timeZone: tz, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }); }catch{ return new Date().toISOString(); } }
function applyWatermark(text, S){ const wm=(S.ADMIN_WATERMARK||'').trim(); if(!wm) return text; return S.WATERMARK_POSITION==='top'?`${wm}\n${text}`:`${text}\n${wm}`; }
function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65))+String.fromCodePoint(A+(c.charCodeAt(1)-65)); }
function flagToCC(flag){ const cps=[...flag].map(c=>c.codePointAt(0)); if(cps.length!==2) return ''; const A=0x1F1E6; return String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A)); }

// ========== KV helper ==========
const KV = {
  async get(env, key){ try{ return env.BOT_DATA ? JSON.parse(await env.BOT_DATA.get(key) || 'null') : null; }catch{ return null; } },
  async set(env, key, val, ttlSec){
    if(!env.BOT_DATA) return;
    const opts = ttlSec ? {expirationTtl: ttlSec} : undefined;
    await env.BOT_DATA.put(key, JSON.stringify(val), opts);
  },
  async pushId(env, id){
    const set=new Set((await KV.get(env,KV_SUBS))||[]);
    set.add(String(id)); await KV.set(env,KV_SUBS,Array.from(set));
  }
};

// ========== Telegram ==========
async function trackTraffic(env, bytes){ const key=KV_TRAFFIC_DAILY+todayKeyUTC(); const cur=await KV.get(env,key)||{bytesOut:0}; cur.bytesOut=(cur.bytesOut||0)+Math.max(0, bytes|0); await KV.set(env,key,cur); }
async function sendMessage(S, env, chat_id, text, reply_markup=null){
  const body={chat_id,text:applyWatermark(text,S),parse_mode:'Markdown',disable_web_page_preview:true}; if(reply_markup) body.reply_markup=reply_markup;
  const payload=JSON.stringify(body); await trackTraffic(env,payload.length);
  const r=await fetch(S.TELEGRAM_API_URL+'sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  return r.json().catch(()=>({}));
}
async function editMessage(S, env, chat_id, message_id, text, reply_markup=null){
  const body={chat_id,message_id,text:applyWatermark(text,S),parse_mode:'Markdown',disable_web_page_preview:true}; if(reply_markup) body.reply_markup=reply_markup;
  const payload=JSON.stringify(body); await trackTraffic(env,payload.length);
  const r=await fetch(S.TELEGRAM_API_URL+'editMessageText',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  return r.json().catch(()=>({}));
}
async function answerCallback(S,id,text=null,show=false){
  const body={callback_query_id:id}; if(text){body.text=text; body.show_alert=show;}
  await fetch(S.TELEGRAM_API_URL+'answerCallbackQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

// ========== Pool Helper ==========
function parsePoolText(text){ return text.split(/\r?\n|,/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')); }
async function fetchRemotePool(S){ const r=await fetch(S.PROXY_POOL_URL); if(!r.ok) throw new Error('remote fail'); const ct=r.headers.get('content-type')||''; if(ct.includes('json')){ const j=await r.json(); if(Array.isArray(j)) return j.map(String); if(j&&Array.isArray(j.list)) return j.list.map(String); throw new Error('bad json'); } return parsePoolText(await r.text()); }
async function fetchPool(S, env){
  const local=S.PROXY_POOL||[]; let remote=[];
  if(S.PROXY_POOL_URL){
    const cached=await KV.get(env,KV_REMOTE_POOL); const now=ts();
    if(cached && now-(cached.updatedAt||0)<S.PROXY_POOL_TTL*1000){ remote=cached.list||[]; }
    else { try{ remote=await fetchRemotePool(S); await KV.set(env,KV_REMOTE_POOL,{updatedAt:now,list:remote}); }catch{ remote=(cached?.list)||[]; } }
  }
  const merged = Array.from(new Set([...local,...remote]));
  return S.SCAN_LIMIT>0 ? merged.slice(0,S.SCAN_LIMIT) : merged;
}
function parseIPPort(s){ const p=s.split(':'); return p.length===2?{ip:p[0],port:p[1]}:{ip:s,port:'443'}; }
function ipValid(ip){ const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/; const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/; return v4.test(ip)||v6.test(ip); }
function portValid(p){ const n=Number(p); return Number.isInteger(n)&&n>0&&n<=65535; }

// ========== Timeout & concurrency ==========
async function fetchWithTimeout(url, ms){
  const c = new AbortController();
  const t = setTimeout(()=>c.abort(), ms);
  try{ return await fetch(url, {signal: c.signal}); }
  finally{ clearTimeout(t); }
}
async function pLimit(concurrency, tasks){
  const ret = [];
  let i = 0, active = 0;
  return new Promise(resolve=>{
    const next = () => {
      if(i === tasks.length && active === 0) return resolve(ret);
      while(active < concurrency && i < tasks.length){
        const cur = tasks[i++]();
        active++;
        Promise.resolve(cur).then(v=>ret.push(v)).catch(()=>ret.push(null)).finally(()=>{ active--; next(); });
      }
    };
    next();
  });
}

// ========== Meta API ==========
async function fetchMeta(S, ip, port){
  if(!S.META_API) return {};
  const r = await fetchWithTimeout(S.META_API + encodeURIComponent(ip)+':'+encodeURIComponent(port), S.META_TIMEOUT_MS).catch(()=>null);
  if(!r || !r.ok) return {};
  return r.json().catch(()=>({}));
}
const headerFromMeta = (m)=> {
  const flag=m.flag||'🏳️'; const country=m.country||'Unknown'; const isp=m.isp||'Unknown ISP';
  const ms=(m.delay!=null)?`${m.delay} ms`:'-';
  return `*${flag} ${country}* • *${isp}* • *${ms}*`;
};

// ========== Keyboard ==========
const K_MAIN = { inline_keyboard:[ [{text:'📱 Menu User', callback_data:'OPEN_CMD|/menu_user'}], [{text:'⚙️ Menu Admin', callback_data:'OPEN_CMD|/menu_admin'}] ] };
function K_USER(){ return { inline_keyboard:[
  [{text:'🎲 Random Proxy', callback_data:'OPEN_CMD|/random_proxy'}],
  [{text:'🌍 Proxy per Negara', callback_data:'OPEN_CMD|/proxyip'}],
  [{text:'⬅️ Kembali', callback_data:'OPEN_CMD|/menu'}]
]}; }
function K_ADMIN(){ return { inline_keyboard:[
  [{text:'📊 Stats', callback_data:'OPEN_CMD|/stats'}],
  [{text:'⬅️ Kembali ke Menu User', callback_data:'OPEN_CMD|/menu_user'}]
]}; }
function K_countryList(list, page, pageSize){
  const start=page*pageSize; const slice=list.slice(start, start+pageSize);
  const rows = slice.map(c=>[{ text:`${c.flag} ${c.cc} (${c.count})`, callback_data:`CSEL|${c.cc}|${page}` }]);
  const nav=[]; if(start>0) nav.push({text:'⬅️ Prev', callback_data:`CPAGE|${page-1}`}); if(start+pageSize<list.length) nav.push({text:'Next ➡️', callback_data:`CPAGE|${page+1}`}); nav.push({text:'↩️ Back', callback_data:'OPEN_CMD|/menu_user'});
  rows.push(nav); return { inline_keyboard: rows };
}
function K_ipList(cc, ips){
  const rows=ips.map(ip=>[{text:ip, callback_data:`PUSE|${cc}|${encodeURIComponent(ip)}`}]);
  rows.push([{text:'↩️ Back', callback_data:'OPEN_CMD|/proxyip'}]);
  return { inline_keyboard: rows };
}

// ========== Country counts & IPs (FAST + cache) ==========
async function countryCounts(S, env){
  const cached = await KV.get(env, KV_COUNTRY_COUNTS);
  if(cached) return cached;

  const pool = await fetchPool(S, env);
  const list = S.SCAN_LIMIT>0 ? pool.slice(0,S.SCAN_LIMIT) : pool;

  const tasks = list.map(raw => () => (async ()=>{
    const {ip,port} = parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return null;
    const m = await fetchMeta(S, ip, port);
    if(!m || (!m.flag && !m.country)) return null;
    let cc = m.flag ? flagToCC(m.flag) : (m.country||'').slice(0,2).toUpperCase();
    if(!cc) return null;
    return { cc, flag: m.flag || ccToFlag(cc) };
  })());

  const results = await pLimit(S.CONCURRENCY, tasks);
  const map = new Map();
  for(const r of results){
    if(!r) continue;
    const cur = map.get(r.cc) || { cc:r.cc, flag:r.flag, count:0 };
    cur.count++; map.set(r.cc, cur);
  }
  const out = Array.from(map.values()).sort((a,b)=>b.count-a.count);
  await KV.set(env, KV_COUNTRY_COUNTS, out, S.COUNTRY_CACHE_TTL);
  return out;
}

async function activeIPsByCountry(S, env, cc, limit=10){
  const CK = KV_COUNTRY_IPS(cc);
  const cached = await KV.get(env, CK);
  if(cached && Array.isArray(cached) && cached.length) return cached.slice(0, limit);

  const flag = ccToFlag(cc);
  const pool = await fetchPool(S, env);
  const list = S.SCAN_LIMIT>0 ? pool.slice(0,S.SCAN_LIMIT) : pool;

  const tasks = list.map(raw => () => (async ()=>{
    const {ip,port} = parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return null;
    const m = await fetchMeta(S, ip, port);
    if(!m) return null;
    const match = (m.flag===flag) || (m.country && m.country.toUpperCase().startsWith(cc));
    return match ? `${ip}:${port}` : null;
  })());

  const results = await pLimit(S.CONCURRENCY, tasks);
  const out = results.filter(Boolean).slice(0, limit);
  await KV.set(env, CK, out, S.ACTIVE_IPS_TTL);
  return out;
}

// ========== Random list (pakai meta paralel) ==========
async function randomProxyList(S, env, count){
  const pool=await fetchPool(S, env);
  const shuffled=pool.slice().sort(()=>Math.random()-0.5);
  const segment=shuffled.slice(0, Math.max(count*3, count+8)); // ambil lebih banyak utk seleksi

  const tasks = segment.map(raw => () => (async ()=>{
    const {ip,port}=parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) return null;
    const m=await fetchMeta(S,ip,port);
    if(!m) return null;
    return {ip,port,meta:m};
  })());

  const results = (await pLimit(S.CONCURRENCY, tasks)).filter(Boolean);
  return results.slice(0, count);
}

// ========== Worker ==========
export default {
  async fetch(request, env){
    try{
      const url=new URL(request.url);
      if(url.pathname!=='/webhook') return new Response('Not Found',{status:404});
      if(request.method!=='POST') return new Response('Method Not Allowed',{status:405});

      const S=buildSettings(env);
      const body=await request.json();

      // ===== Callback =====
      if(body.callback_query){
        const cb=body.callback_query; const chatId=String(cb.message?.chat?.id||''); const data=cb.data||'';
        const edit=(text, kb=null)=>editMessage(S,env,chatId,cb.message.message_id,text,kb);

        if(data.startsWith('OPEN_CMD|')){ const cmd=data.slice(9); await answerCallback(S,cb.id,'OK'); body.message={ chat:{id:chatId,type:'private'}, text:cmd, from:cb.from }; delete body.callback_query; }
        else if(data.startsWith('CPAGE|')){ const page=Number(data.split('|')[1]||0); const list=await countryCounts(S,env); await answerCallback(S,cb.id); await edit('*🌍 Pilih negara:*', K_countryList(list,page,S.COUNTRY_PAGE_SIZE)); return new Response('OK',{status:200}); }
        else if(data.startsWith('CSEL|')){ const [,cc,pageStr]=data.split('|'); await answerCallback(S,cb.id); const loading=await edit(`⏳ Memindai IP aktif untuk ${ccToFlag(cc)} *${cc}*...`); const ips=await activeIPsByCountry(S,env,cc,10); if(!ips.length){ const list=await countryCounts(S,env); await edit(`❌ Tidak ada IP aktif untuk ${ccToFlag(cc)} *${cc}*.`, K_countryList(list, Number(pageStr||0), S.COUNTRY_PAGE_SIZE)); } else { await edit(`✅ *IP aktif untuk* ${ccToFlag(cc)} *${cc}*:\nPilih salah satu:`, K_ipList(cc,ips)); } return new Response('OK',{status:200}); }
        else if(data.startsWith('PUSE|')){ const [,cc,enc]=data.split('|'); const ipport=decodeURIComponent(enc); await answerCallback(S,cb.id); await edit(`🔌 *Target:* \`${ipport}\`\n(Generate manual lewat perintah lain).`, { inline_keyboard:[[{text:'↩️ Back',callback_data:'OPEN_CMD|/proxyip'}]]}); return new Response('OK',{status:200}); }
        else { await answerCallback(S,cb.id); return new Response('OK',{status:200}); }
      }

      // ===== Message =====
      if(body.message){
        const msg=body.message; const chatId=String(msg.chat.id); const chatType=String(msg.chat.type||'private'); const firstName=(msg.from?.first_name)||''; const username=msg.from?.username?('@'+msg.from.username):'';
        const isAdmin=S.ADMIN_IDS.map(String).includes(chatId);

        await KV.pushId(env, chatId);
        const text=(msg.text||'').trim();

        // start/menu
        if(text.startsWith('/start') || text.startsWith('/menu')){
          const hello = `Halo *${firstName}*, aku adalah asisten pribadimu.\nTolong rawat aku ya seperti kamu merawat diri sendiri 😘\n\n👤 Nama: *${firstName}* ${username?`(${username})`:''}\n🆔 ID: \`${chatId}\`\n🕒 Waktu: _${formatNowTZ(S.TIMEZONE)}_`;
          await sendMessage(S, env, chatId, hello, K_MAIN);
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/menu_user')){ await sendMessage(S, env, chatId, '*Menu User*', K_USER()); return new Response('OK',{status:200}); }
        if(text.startsWith('/menu_admin')){
          if(!isAdmin){ await sendMessage(S, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); }
          await sendMessage(S, env, chatId, '*Menu Admin*', K_ADMIN()); return new Response('OK',{status:200});
        }

        // random proxy
        if(text.startsWith('/random_proxy')){
          const list = await randomProxyList(S, env, S.RANDOM_PROXY_COUNT);
          if(!list.length){ await sendMessage(S, env, chatId, '❌ Tidak ada proxy valid.'); return new Response('OK',{status:200}); }
          const lines = list.map((x,i)=>{ const m=x.meta||{}; const flag=m.flag||'🏳️'; const isp=m.isp||'-'; const country=m.country||'-'; const ms=(m.delay!=null)?`${m.delay} ms`:'-'; return `${i+1}. ${flag} \`${x.ip}:${x.port}\` — *${isp}* • ${country} • ${ms}`; });
          await sendMessage(S, env, chatId, `🎲 *Random Proxy (Top ${lines.length})*\n`+lines.join('\n'));
          return new Response('OK',{status:200});
        }

        // proxy per negara
        if(text.startsWith('/proxyip')){
          const loading = await sendMessage(S, env, chatId, '⏳ Menyiapkan daftar negara…');
          const list=await countryCounts(S,env);
          await editMessage(S, env, chatId, loading.result?.message_id, '*🌍 Pilih negara:*', K_countryList(list,0,S.COUNTRY_PAGE_SIZE));
          return new Response('OK',{status:200});
        }

        // stats sederhana
        if(text.startsWith('/stats')){
          const vals = await Promise.all(lastNDaysKeys(7).map(k=>KV.get(env, KV_TRAFFIC_DAILY+k)));
          const today=(vals[6]?.bytesOut)||0; const total=vals.reduce((a,b)=>a+((b?.bytesOut)||0),0);
          await sendMessage(S,env,chatId, `*Bandwidth (payload Telegram)*\n📅 Hari ini: *${bytesHuman(today)}*\n🗓 7 hari: *${bytesHuman(total)}*`);
          return new Response('OK',{status:200});
        }

        // fallback
        if(text){ await sendMessage(S, env, chatId, '✅ Bot aktif! Silakan kirim /menu lagi untuk fitur lengkap.'); }
        return new Response('OK',{status:200});
      }

      return new Response('OK',{status:200});
    }catch(e){ console.error(e); return new Response('Bad Request',{status:400}); }
  }
};
