// src/proxy.js
export async function loadProxies() {
  const resp = await fetch('https://raw.githubusercontent.com/muhaip2/botku/main/ProxyList.json');
  if (!resp.ok) throw new Error('Gagal mengambil ProxyList.json');
  return await resp.json();
}

export function getProxiesByCountry(all, country) {
  return all
    .filter(p => p.country === country)
    .map(p => `${p.ip}:${p.port}`);
}

export function buildProxyInfo(p) {
  return `
🛰 *Informasi Alamat IP* 🛰
🌐 Proxy Host : \`${p.ip}\`
🔌 Proxy Port : \`${p.port}\`
🏙 ISP        : ${p.isp || '-'}
🇨🇺 Negara    : ${p.country || '-'}
🏢 Kota       : ${p.city || '-'}
🏷 ASN        : ${p.asn || '-'}
📶 Delay      : ${p.delay || '-'} ms

🔥 Proxy Aktif!
Anda dapat membuat akun dengan IP Proxy ini
  `;
}
