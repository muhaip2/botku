// src/bot.js — versi “fitur utama”
// ENV yang dipakai:
// TELEGRAM_API_URL, ADMIN_IDS, TIMEZONE,
// PROXY_POOL_URL, PASSUUID, SERVER_VLESS, SERVER_TROJAN,
// WILDCARD_MAP_JSON (opsional: {"cache":"cache.netflix.com","quiz":"quiz.vidio.com"})
//
// API_URL harus mengembalikan JSON meta utk IP:PORT, contoh field:
// { flag:"🇮🇩", country:"Indonesia", isp:"PT X", delay:123, proxyHost:"x.x.x.x", proxyPort:"443" }

function buildSettings(env){
  const list = v => String(v||'').split(',').map(s=>s.trim()).filter(Boolean);
  let WILDCARD_MAP = { cache: "cache.netflix.com", quiz: "quiz.vidio.com", support: "support.zoom.us" };
  try {
    if (env.WILDCARD_MAP_JSON) {
      const j = JSON.parse(env.WILDCARD_MAP_JSON);
      if (j && typeof j === 'object') WILDCARD_MAP = j;
    }
  } catch {}
  return {
    API: env.TELEGRAM_API_URL || '',
    ADMIN_IDS: list(env.ADMIN_IDS),
    TZ: env.TIMEZONE || 'Asia/Jakarta',
    // pool & meta
    POOL_URL: env.PROXY_POOL_URL || '',
    PASSUUID: env.PASSUUID || '',
    SERVER_VLESS: env.SERVER_VLESS || '',
    SERVER_TROJAN: env.SERVER_TROJAN || '',
    META_API: env.API_URL || '',
    REQ_DELAY_MS: 35,
    RANDOM_COUNT: 10,
    PAGE_SIZE: 18,
    WILDCARD_MAP
  };
}

function nowTZ(tz){
  try{
    return new Date().toLocaleString('id-ID',{
      timeZone: tz, weekday:'long', year:'numeric', month:'long',
      day:'numeric', hour:'2-digit', minute:'2-digit'
    });
  }catch{ return new Date().toISOString(); }
}

async function tg(method, body, API){
  return fetch(API + method, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body)
  }).then(r=>r.json()).catch(()=>({}));
}
async function sendMessage(API, chat_id, text, reply_markup=null){
  const body={ chat_id, text, parse_mode:'Markdown', disable_web_page_preview:true };
  if(reply_markup) body.reply_markup = reply_markup;
  return tg('sendMessage', body, API);
}
async function editMessage(API, chat_id, message_id, text, reply_markup=null){
  const body={ chat_id, message_id, text, parse_mode:'Markdown', disable_web_page_preview:true };
  if(reply_markup) body.reply_markup = reply_markup;
  return tg('editMessageText', body, API);
}

const K_MAIN = {
  inline_keyboard: [
    [{ text:'📱 Menu User',  callback_data:'OPEN|/menu_user' }],
    [{ text:'⚙️ Menu Admin', callback_data:'OPEN|/menu_admin' }],
  ]
};
const K_USER = {
  inline_keyboard: [
    [{ text:'🎲 Random Proxy', callback_data:'OPEN|/random_proxy' }],
    [{ text:'🌍 Proxy per Negara', callback_data:'OPEN|/proxyip' }],
    [{ text:'⬅️ Kembali', callback_data:'OPEN|/menu' }],
  ]
};
const K_ADMIN = {
  inline_keyboard: [
    [{ text:'📝 Broadcast', callback_data:'OPEN|/broadcast' }],
    [{ text:'📊 Stats', callback_data:'OPEN|/stats' }],
    [{ text:'⬅️ Kembali ke Menu User', callback_data:'OPEN|/menu_user' }],
  ]
};

// ---------- Pool & Meta helpers ----------
function parsePoolText(txt){
  return txt.split(/\r?\n|,/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
}
function parseIPPort(s){
  const p = s.split(':');
  return p.length===2 ? { ip:p[0], port:p[1] } : { ip:s, port:'443' };
}
function ipValid(ip){
  const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  return v4.test(ip);
}
function portValid(p){ const n=+p; return Number.isInteger(n)&&n>0&&n<=65535; }

async function fetchPool(S){
  if(!S.POOL_URL) return [];
  const r = await fetch(S.POOL_URL);
  if(!r.ok) return [];
  const ct = r.headers.get('content-type')||'';
  if(ct.includes('json')){
    const j = await r.json();
    if (Array.isArray(j)) return j.map(String);
    if (j && Array.isArray(j.list)) return j.list.map(String);
    return [];
  }
  return parsePoolText(await r.text());
}
async function fetchMeta(S, ip, port){
  if(!S.META_API) return {};
  const r = await fetch(S.META_API+encodeURIComponent(ip)+':'+encodeURIComponent(port));
  if(!r.ok) return {};
  return r.json().catch(()=>({}));
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function flagToCC(flag){
  try{
    const cps=[...flag].map(c=>c.codePointAt(0));
    if(cps.length!==2) return '';
    const A=0x1F1E6;
    return String.fromCharCode(65+(cps[0]-A))+String.fromCharCode(65+(cps[1]-A));
  }catch{ return ''; }
}
function ccToFlag(cc){
  const A=0x1F1E6;
  const c=cc.toUpperCase();
  try{
    return String.fromCodePoint(A+(c.charCodeAt(0)-65)) + String.fromCodePoint(A+(c.charCodeAt(1)-65));
  }catch{ return '🏳️'; }
}

// ---------- Keyboards dinamis ----------
function K_countryList(items, page, size){
  const start=page*size, slice=items.slice(start, start+size);
  const rows = slice.map(c => [{ text:`${c.flag} ${c.cc} (${c.count})`, callback_data:`CSEL|${c.cc}|${page}` }]);
  const nav=[];
  if(start>0) nav.push({text:'⬅️ Prev', callback_data:`CPAGE|${page-1}`});
  if(start+size<items.length) nav.push({text:'Next ➡️', callback_data:`CPAGE|${page+1}`});
  nav.push({text:'↩️ Back', callback_data:'OPEN|/menu_user'});
  rows.push(nav);
  return { inline_keyboard: rows };
}
function K_ipList(cc, list){
  const rows = list.map(ip => [{ text: ip, callback_data:`PUSE|${cc}|${encodeURIComponent(ip)}` }]);
  rows.push([{ text:'↩️ Back', callback_data:'OPEN|/proxyip' }]);
  return { inline_keyboard: rows };
}
function K_proto(ip, port){
  return {
    inline_keyboard: [
      [{ text:'⚡ VLESS',  callback_data:`GEN|VLESS|${ip}|${port}` },
       { text:'🛡 TROJAN', callback_data:`GEN|TROJAN|${ip}|${port}` }],
      [{ text:'↩️ Back', callback_data:'OPEN|/proxyip' }]
    ]
  };
}
function K_wildcard(S, proto, ip, port){
  const rows = [[{ text:'🚫 Tanpa Wildcard', callback_data:`WSEL|${proto}|${ip}|${port}|__NONE__` }]];
  for(const k of Object.keys(S.WILDCARD_MAP)){
    rows.push([{ text:S.WILDCARD_MAP[k], callback_data:`WSEL|${proto}|${ip}|${port}|${k}` }]);
  }
  rows.push([{ text:'↩️ Back', callback_data:`GEN|${proto}|${ip}|${port}` }]);
  return { inline_keyboard: rows };
}

// ---------- Generator config ----------
function vlessTLS(S, hostSNI, innerHost, innerPort, tag){
  const u=S.PASSUUID, enc=encodeURIComponent(tag||'');
  return `vless://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`;
}
function vlessNTLS(S, hostSNI, innerHost, innerPort, tag){
  const u=S.PASSUUID, enc=encodeURIComponent(tag||'');
  return `vless://${u}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}
function trojanTLS(S, hostSNI, innerHost, innerPort, tag){
  const u=S.PASSUUID, enc=encodeURIComponent(tag||'');
  return `trojan://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`;
}
function trojanNTLS(S, hostSNI, innerHost, innerPort, tag){
  const u=S.PASSUUID, enc=encodeURIComponent(tag||'');
  return `trojan://${u}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}
function wildcardHostByKey(S, key){
  const v=S.WILDCARD_MAP[key];
  if(!v) return null;
  if(v.includes('.')) return v;
  // kalau value bukan FQDN, pakai SERVER_WILDCARD (opsional). Abaikan untuk versi ini.
  return v;
}
function headerFromMeta(m){
  const flag=m.flag||'🏳️', country=m.country||'Unknown', isp=m.isp||'Unknown ISP';
  const ms = (m.delay!=null)? `${m.delay} ms` : '-';
  return `*${flag} ${country}* • *${isp}* • *${ms}*`;
}

// ---------- Fitur inti ----------
async function randomProxyList(S){
  const pool = await fetchPool(S);
  const shuffled = pool.slice().sort(()=>Math.random()-0.5);
  const out=[];
  for(const raw of shuffled){
    const {ip,port} = parseIPPort(raw);
    if(!ipValid(ip) || !portValid(port)) continue;
    try{
      const m = await fetchMeta(S, ip, port);
      out.push({ip,port,meta:m});
    }catch{}
    if(out.length>=S.RANDOM_COUNT) break;
    if(S.REQ_DELAY_MS) await sleep(S.REQ_DELAY_MS);
  }
  return out;
}

async function countryCounts(S){
  const map = new Map(); // cc -> {cc,flag,count}
  const pool = await fetchPool(S);
  for(const raw of pool){
    const {ip,port} = parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) continue;
    try{
      const m = await fetchMeta(S, ip, port);
      let cc = m.flag ? flagToCC(m.flag) : '';
      if(!cc && m.country) cc = m.country.slice(0,2).toUpperCase();
      if(!cc) continue;
      const cur = map.get(cc) || { cc, flag: m.flag || ccToFlag(cc), count:0 };
      cur.count++;
      map.set(cc, cur);
    }catch{}
    if(S.REQ_DELAY_MS) await sleep(S.REQ_DELAY_MS);
  }
  return Array.from(map.values()).sort((a,b)=>b.count-a.count);
}

async function activeIPsByCountry(S, cc, limit=10){
  const flag = ccToFlag(cc);
  const out=[];
  const pool = await fetchPool(S);
  for(const raw of pool){
    const {ip,port} = parseIPPort(raw);
    if(!ipValid(ip)||!portValid(port)) continue;
    try{
      const m=await fetchMeta(S, ip, port);
      const match = (m.flag===flag) || (m.country && m.country.toUpperCase().startsWith(cc));
      if(match){
        out.push(`${ip}:${port}`);
        if(out.length>=limit) break;
      }
    }catch{}
    if(S.REQ_DELAY_MS) await sleep(S.REQ_DELAY_MS);
  }
  return out;
}

// ---------- Worker ----------
export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const S = buildSettings(env);

    if(request.method==='GET' && url.pathname==='/health') {
      return new Response('ok', {status:200});
    }
    if(url.pathname!=='/webhook'){
      return new Response('Not Found', {status:404});
    }
    if(request.method!=='POST'){
      return new Response('Method Not Allowed', {status:405});
    }

    let update={};
    try{ update = await request.json(); }catch{}

    // handle callback -> transform ke message
    if(update.callback_query){
      const cb = update.callback_query;
      const data = cb.data || '';
      if(data.startsWith('OPEN|')){
        update.message = { chat: cb.message.chat, from: cb.from, text: data.slice(5) };
      }
      // proses callback khusus
      else if(data.startsWith('CPAGE|')){
        const page = Number(data.split('|')[1]||0);
        const list = await countryCounts(S);
        await tg('answerCallbackQuery', {callback_query_id: cb.id}, S.API);
        await editMessage(S.API, String(cb.message.chat.id), cb.message.message_id, '*🌍 Pilih negara:*', K_countryList(list, page, S.PAGE_SIZE));
        return new Response('OK', {status:200});
      }
      else if(data.startsWith('CSEL|')){
        const [,cc,pageStr] = data.split('|');
        const ips = await activeIPsByCountry(S, cc, 10);
        const chatId = String(cb.message.chat.id);
        await tg('answerCallbackQuery', {callback_query_id: cb.id}, S.API);
        if(!ips.length){
          const list = await countryCounts(S);
          await editMessage(S.API, chatId, cb.message.message_id, `❌ Tidak ada IP aktif untuk ${ccToFlag(cc)} *${cc}*.`, K_countryList(list, Number(pageStr||0), S.PAGE_SIZE));
        }else{
          await editMessage(S.API, chatId, cb.message.message_id, `✅ *IP aktif untuk* ${ccToFlag(cc)} *${cc}*.\nPilih salah satu:`, K_ipList(cc, ips));
        }
        return new Response('OK', {status:200});
      }
      else if(data.startsWith('PUSE|')){
        const [,cc,enc] = data.split('|');
        const ipport = decodeURIComponent(enc);
        const {ip,port} = parseIPPort(ipport);
        const chatId = String(cb.message.chat.id);
        await tg('answerCallbackQuery', {callback_query_id: cb.id}, S.API);
        await editMessage(S.API, chatId, cb.message.message_id, `🔌 *Target:* \`${ip}:${port}\`\nPilih protokol:`, K_proto(ip,port));
        return new Response('OK', {status:200});
      }
      else if(data.startsWith('GEN|')){
        const [,proto,ip,port] = data.split('|');
        const chatId = String(cb.message.chat.id);
        await tg('answerCallbackQuery', {callback_query_id: cb.id}, S.API);
        await editMessage(S.API, chatId, cb.message.message_id, `🎛 *${proto}* untuk \`${ip}:${port}\`\nPilih wildcard:`, K_wildcard(S, proto, ip, port));
        return new Response('OK', {status:200});
      }
      else if(data.startsWith('WSEL|')){
        const [,proto,ip,port,key] = data.split('|');
        const chatId = String(cb.message.chat.id);
        await tg('answerCallbackQuery', {callback_query_id: cb.id, text:'Membuat config...'}, S.API);

        const sni = key==='__NONE__'
          ? (proto==='VLESS' ? S.SERVER_VLESS : S.SERVER_TROJAN)
          : wildcardHostByKey(S, key);

        if(!sni){
          await sendMessage(S.API, chatId, '❌ SNI/Host tidak ditemukan. Cek env SERVER_VLESS / SERVER_TROJAN atau WILDCARD_MAP_JSON.');
          return new Response('OK', {status:200});
        }
        try{
          const m = await fetchMeta(S, ip, port);
          const tag = `${m.isp||ip} ${m.flag||''}`.trim();
          const innerHost = m.proxyHost || ip;
          const innerPort = m.proxyPort || port;
          const tls = (proto==='VLESS')
            ? vlessTLS(S, sni, innerHost, innerPort, tag)
            : trojanTLS(S, sni, innerHost, innerPort, tag);
          const ntls = (proto==='VLESS')
            ? vlessNTLS(S, sni, innerHost, innerPort, tag)
            : trojanNTLS(S, sni, innerHost, innerPort, tag);

          await editMessage(
            S.API, chatId, cb.message.message_id,
            `✅ *Config ${proto}*\n${headerFromMeta(m)}\n\n🔒 *${proto} — TLS*\n\`\`\`\n${tls}\n\`\`\`\n🔓 *${proto} — NTLS*\n\`\`\`\n${ntls}\n\`\`\``
          );
        }catch{
          await sendMessage(S.API, chatId, `❌ Gagal membuat config untuk ${ip}:${port}`);
        }
        return new Response('OK', {status:200});
      }

      // selesai callback umum
      await tg('answerCallbackQuery', {callback_query_id: cb.id}, S.API);
    }

    if(update.message){
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const firstName = msg.from?.first_name || '';
      const username = msg.from?.username ? ('@'+msg.from.username) : '';
      const isAdmin = S.ADMIN_IDS.includes(chatId);
      const text = (msg.text || '').trim();

      if(text==='/start' || text==='/menu'){
        const hello =
`Halo *${firstName}*, aku adalah asisten pribadimu.
Tolong rawat aku ya seperti kamu merawat diri sendiri 😘

👤 Nama: *${firstName}* ${username?`(${username})`:''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${nowTZ(S.TZ)}_`;
        await sendMessage(S.API, chatId, hello, K_MAIN);
        return new Response('OK', {status:200});
      }

      if(text==='/menu_user'){
        await sendMessage(S.API, chatId, '*Menu User*', K_USER);
        return new Response('OK', {status:200});
      }

      if(text==='/menu_admin'){
        if(!isAdmin){
          await sendMessage(S.API, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
          return new Response('OK', {status:200});
        }
        await sendMessage(S.API, chatId, '*Menu Admin*', K_ADMIN);
        return new Response('OK', {status:200});
      }

      // ---- fitur: random proxy (10) ----
      if(text==='/random_proxy'){
        const list = await randomProxyList(S);
        if(!list.length){
          await sendMessage(S.API, chatId, '❌ Tidak ada proxy valid dari pool.');
          return new Response('OK', {status:200});
        }
        const lines = list.map((x,i)=>{
          const m=x.meta||{};
          const flag=m.flag||'🏳️';
          const isp=m.isp||'-';
          const country=m.country||'-';
          const ms=(m.delay!=null)?`${m.delay} ms`:'-';
          return `${i+1}. ${flag} \`${x.ip}:${x.port}\` — *${isp}* • ${country} • ${ms}`;
        });
        await sendMessage(S.API, chatId, `🎲 *Random Proxy (Top ${lines.length})*\n`+lines.join('\n'));
        return new Response('OK', {status:200});
      }

      // ---- fitur: proxy per negara ----
      if(text==='/proxyip'){
        const list = await countryCounts(S);
        if(!list.length){
          await sendMessage(S.API, chatId, '❌ Tidak ada data negara dari pool.');
          return new Response('OK', {status:200});
        }
        await sendMessage(S.API, chatId, '*🌍 Pilih negara:*', K_countryList(list, 0, S.PAGE_SIZE));
        return new Response('OK', {status:200});
      }

      // placeholder fitur admin
      if(text==='/broadcast' || text==='/stats'){
        if(text==='/broadcast' && !isAdmin){
          await sendMessage(S.API, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
        }else{
          await sendMessage(S.API, chatId, '✅ Bot aktif. Fitur ini akan dilanjutkan di tahap berikutnya.');
        }
        return new Response('OK', {status:200});
      }

      return new Response('OK', {status:200});
    }

    return new Response('OK', {status:200});
  }
};
