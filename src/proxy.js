// src/proxy.js
//
// Utilitas untuk membaca ProxyList.json, paging negara & proxy,
// serta ambil info IP dan format pesan seperti contoh kamu.

const CACHE_TTL_MS = 60_000; // cache 1 menit di memori worker

// cache sederhana di memori (per instance)
let _cache = { at: 0, data: null };

/** Ambil URL list proxy dari env */
function resolveListUrl(env) {
  // dukung kedua nama variabel agar fleksibel
  return (
    env.PROXY_LIST_URL ||
    env.PROXY_POOL_URL || // kalau sebelumnya pakai ini
    null
  );
}

/** Ambil dan cache ProxyList.json (array objek {ip,port,country,city,isp,asn,delay}) */
async function loadProxyList(env) {
  const now = Date.now();
  if (_cache.data && now - _cache.at < CACHE_TTL_MS) return _cache.data;

  const url = resolveListUrl(env);
  if (!url) throw new Error('PROXY_LIST_URL/PROXY_POOL_URL belum diset di Variables');

  const resp = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!resp.ok) throw new Error(`Gagal mengambil ProxyList.json: ${resp.status}`);
  const data = await resp.json();

  if (!Array.isArray(data)) throw new Error('Format ProxyList.json tidak valid (harus array)');
  _cache = { at: now, data };
  return data;
}

/** Map kode negara → emoji bendera sederhana */
function flag(country = '') {
  // coba ambil 2 huruf terakhir jika bentuk "Country Name, ID"
  const m = /,?\s*([A-Z]{2})$/.exec(country);
  const cc = m ? m[1] : null;
  if (!cc) return '🌍';
  // ubah "ID" → 🇮 + 🇩
  return cc
    .toUpperCase()
    .split('')
    .map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    .join('');
}

/** Kembalikan daftar negara unik (berurutan alfabet), dengan paging */
export async function listCountries(env, page = 1, pageSize = 6) {
  const all = await loadProxyList(env);
  const set = new Set(
    all.map(p => (p.country || '').trim()).filter(Boolean)
  );
  const arr = [...set].sort((a, b) => a.localeCompare(b));

  const start = (page - 1) * pageSize;
  const slice = arr.slice(start, start + pageSize);

  return {
    items: slice.map(name => ({
      name,
      flag: flag(name)
    })),
    page,
    pageSize,
    total: arr.length,
    hasPrev: page > 1,
    hasNext: start + pageSize < arr.length
  };
}

/** Ambil daftar proxy untuk 1 negara, dipaging */
export async function getProxiesForCountry(env, countryName, page = 1, pageSize = 6) {
  const all = await loadProxyList(env);
  const filtered = all.filter(
    p => (p.country || '').trim().toLowerCase() === (countryName || '').trim().toLowerCase()
  );

  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);

  // normalisasi ke string host:port + objek aslinya
  const entries = slice.map(p => ({
    label: `${p.ip}:${p.port}`,
    raw: p
  }));

  return {
    items: entries,
    page,
    pageSize,
    total: filtered.length,
    hasPrev: page > 1,
    hasNext: start + pageSize < filtered.length
  };
}

/** Ambil info IP dengan API yang kamu set di Variables (API_URL) */
export async function fetchIpInfo(env, ip) {
  const base = (env.API_URL || '').trim();
  if (!base) return null;

  // Terima IPv6 juga. API kamu tampaknya pakai query ?ip=
  const url = base.includes('?') ? `${base}${encodeURIComponent(ip)}` : `${base}?ip=${encodeURIComponent(ip)}`;
  const r = await fetch(url, { timeout: 10_000 }).catch(() => null);
  if (!r || !r.ok) return null;

  // adaptif: banyak API geolocation beda-beda field
  const j = await r.json().catch(() => null);
  return j;
}

/** Format pesan info IP seperti contoh (aman jika beberapa field kosong) */
export function formatIpInfo(proxyObj, info) {
  const ip = proxyObj?.ip || '-';
  const port = proxyObj?.port || '-';
  const isp = proxyObj?.isp ?? info?.isp ?? info?.org ?? '-';
  const country = proxyObj?.country ?? info?.country ?? info?.country_name ?? '-';
  const city = proxyObj?.city ?? info?.city ?? '-';
  const asn = proxyObj?.asn ?? info?.asn ?? info?.as ?? info?.asn_org ?? '-';
  const delay = proxyObj?.delay ?? '-';

  return (
`🛰 *Informasi Alamat IP* 🛰
🌐 *Proxy Host* : \`${ip}\`
🔌 *Proxy Port* : \`${port}\`
🧭 *Origin IP*  : \`${proxyObj?.origin || proxyObj?.ip || '-'}\`
🏙 *ISP*        : ${isp}
🇨🇺 *Negara*    : ${country} ${flag(country)}
🏢 *Kota*       : ${city}
🏷 *ASN*        : ${asn}
📶 *Delay*      : ${delay} ms

🔥 *Proxy Aktif!* 
Anda dapat membuat akun dengan IP Proxy ini`
  );
}
