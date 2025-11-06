export const K_MAIN = { inline_keyboard:[
  [{text:'📱 Menu User', callback_data:'OPEN_CMD|/menu_user'}],
  [{text:'⚙️ Menu Admin', callback_data:'OPEN_CMD|/menu_admin'}]
]};

export function K_USER(){ return { inline_keyboard:[
  [{text:'🎲 Random Proxy', callback_data:'OPEN_CMD|/random_proxy'}],
  [{text:'🌍 Proxy per Negara', callback_data:'OPEN_CMD|/proxyip'}],
  [{text:'🚀 Speedtest', callback_data:'OPEN_CMD|/speedtest'},{text:'📶 Bandwidth', callback_data:'OPEN_CMD|/bandwidth'}],
  [{text:'📦 Show Pool Count', callback_data:'OPEN_CMD|/show_pool_count'}],
  [{text:'⬅️ Kembali', callback_data:'OPEN_CMD|/menu'}]
]}; }

export function K_ADMIN(){ return { inline_keyboard:[
  [{text:'📝 Preview Broadcast', callback_data:'OPEN_CMD|/broadcast Halo semua!'}],
  [{text:'📷 Mode Foto Galeri', callback_data:'OPEN_CMD|/broadcast_img'}],
  [{text:'📊 Stats', callback_data:'OPEN_CMD|/stats'},{text:'♻️ Reset Stats', callback_data:'OPEN_CMD|/reset_stats'}],
  [{text:'📦 Show Pool Count', callback_data:'OPEN_CMD|/show_pool_count'},{text:'🔄 Reload Pool', callback_data:'OPEN_CMD|/reload_pool'}],
  [{text:'🛑 Cancel Broadcast', callback_data:'OPEN_CMD|/cancel_broadcast'},{text:'🧾 Status Broadcast', callback_data:'OPEN_CMD|/status_broadcast'}],
  [{text:'🚀 Speedtest', callback_data:'OPEN_CMD|/speedtest'},{text:'📶 Bandwidth', callback_data:'OPEN_CMD|/bandwidth'}],
  [{text:'⬅️ Kembali ke Menu User', callback_data:'OPEN_CMD|/menu_user'}]
]}; }

export function K_countryList(list, page, pageSize){
  const start=page*pageSize; const slice=list.slice(start, start+pageSize);
  const rows = slice.map(c=>[{ text:`${c.flag} ${c.cc} (${c.count})`, callback_data:`CSEL|${c.cc}|${page}` }]);
  const nav=[]; if(start>0) nav.push({text:'⬅️ Prev', callback_data:`CPAGE|${page-1}`}); if(start+pageSize<list.length) nav.push({text:'Next ➡️', callback_data:`CPAGE|${page+1}`}); nav.push({text:'↩️ Back', callback_data:'OPEN_CMD|/menu_user'});
  rows.push(nav); return { inline_keyboard: rows };
}
export function K_ipList(cc, ips){ const rows=ips.map(ip=>[{text:ip, callback_data:`PUSE|${cc}|${encodeURIComponent(ip)}`}]); rows.push([{text:'↩️ Back', callback_data:'OPEN_CMD|/proxyip'}]); return { inline_keyboard: rows }; }
export function K_proto(ip,port){ return { inline_keyboard:[
  [{text:'⚡ VLESS', callback_data:`GEN|VLESS|${ip}|${port}`} ,{text:'🛡 TROJAN', callback_data:`GEN|TROJAN|${ip}|${port}`}],
  [{text:'↩️ Back', callback_data:'OPEN_CMD|/proxyip'}]
]}; }
export function K_wildcard(s, proto, ip, port){ const rows=[[{text:'🚫 Tanpa Wildcard', callback_data:`WSEL|${proto}|${ip}|${port}|__NONE__`}]]; for(const k of Object.keys(s.WILDCARD_MAP)){ const host=(s.WILDCARD_MAP[k].includes('.')?s.WILDCARD_MAP[k] : `${s.WILDCARD_MAP[k]}.${s.SERVER_WILDCARD}`); rows.push([{text:host, callback_data:`WSEL|${proto}|${ip}|${port}|${k}`}]); } rows.push([{text:'↩️ Back', callback_data:`GEN|${proto}|${ip}|${port}`}]); return { inline_keyboard: rows }; }
