export async function fetchMeta(s, ip, port){
  const r=await fetch(s.API_URL+encodeURIComponent(ip)+':'+encodeURIComponent(port));
  if(!r.ok) throw new Error('meta fail');
  return r.json();
}
export function headerFromMeta(m){
  const flag=m.flag||'🏳️'; const country=m.country||'Unknown'; const isp=m.isp||'Unknown ISP';
  const ms=(m.delay!=null)?`${m.delay} ms`:'-';
  return `*${flag} ${country}* • *${isp}* • *${ms}*`;
}

// link generator
export function vlessTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`; }
export function vlessNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `vless://${u}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
export function trojanTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`; }
export function trojanNTLS(s, hostSNI, innerHost, innerPort, tag){ const u=s.PASSUUID, enc=encodeURIComponent(tag||''); return `trojan://${u}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`; }
