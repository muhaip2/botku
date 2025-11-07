// src/proxy.js
// Cache ProxyList agar akses cepat dan tidak membebani jalur webhook.
let _proxyCache = { at: 0, data: [] };
const PROXY_TTL_MS = 5 * 60 * 1000; // 5 menit

/**
 * Ambil daftar proxy dari KV (kunci: ProxyList.json) lalu cache di memori.
 * Jika Anda menyimpan di lokasi lain, ubah bagian pembacaan di bawah.
 */
export async function getProxyList(env) {
  const now = Date.now();
  if (now - _proxyCache.at < PROXY_TTL_MS && _proxyCache.data.length) {
    return _proxyCache.data;
  }

  // --- UBAH BAGIAN INI jika sumber data berbeda ---
  const raw = await env.BOT_DATA.get('ProxyList.json', 'text');
  const arr = JSON.parse(raw || '[]');
  // ------------------------------------------------

  _proxyCache = { at: now, data: Array.isArray(arr) ? arr : [] };
  return _proxyCache.data;
}

// Util ringan bila Anda butuh filter by country di tempat lain
export function proxiesByCountry(list, codeOrName) {
  const key = String(codeOrName || '').toLowerCase();
  return list.filter(p => {
    const cc = String(p.countryCode || p.cc || '').toLowerCase();
    const name = String(p.country || '').toLowerCase();
    return cc === key || name.includes(key);
  });
}
