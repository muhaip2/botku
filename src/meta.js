// src/meta.js
export async function fetchMeta(s, ip, port){
  const u = s.API_URL + encodeURIComponent(ip) + ':' + encodeURIComponent(port);

  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms))
    ]);

  const r = await withTimeout(fetch(u), s.META_TIMEOUT_MS);
  if(!r.ok) throw new Error('meta fail '+r.status);
  return r.json();
}

export function headerFromMeta(m){
  const flag=m.flag||'🏳️'; const country=m.country||'Unknown';
  const isp=m.isp||'Unknown ISP'; const ms=(m.delay!=null)?`${m.delay} ms`:'-';
  return `*${flag} ${country}* • *${isp}* • *${ms}*`;
}
