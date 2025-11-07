// src/proxy.js
// Helper untuk membaca ProxyList.json dan memanggil API info IP.
// Pastikan file ProxyList.json berada di src/ProxyList.json

import ProxyList from './ProxyList.json';

/**
 * listCountries() -> array of country codes (sorted)
 */
export function listCountries() {
  return Object.keys(ProxyList || {}).sort();
}

/**
 * getProxiesForCountry(code) -> array of "ip:port"
 */
export function getProxiesForCountry(code) {
  return ProxyList && ProxyList[code] ? ProxyList[code] : [];
}

/**
 * fetchIpInfo(settings, ip) -> call settings.API_URL
 * settings.API_URL can be:
 *  - "https://ip.example/api?ip="  -> then we append ip
 *  - "https://ip.example/api/{ip}" -> replace {ip}
 *
 * Returns parsed JSON or null on failure.
 */
export async function fetchIpInfo(settings, ip) {
  try {
    if (!settings || !settings.API_URL) return null;
    let url;
    if (settings.API_URL.includes('{ip}')) {
      url = settings.API_URL.replace('{ip}', encodeURIComponent(ip));
    } else {
      url = settings.API_URL + (settings.API_URL.includes('?') ? '&' : '?') + 'ip=' + encodeURIComponent(ip);
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * formatIpInfo(ip, port, info)
 * - info: object returned by API (may be null)
 * Customize field names sesuai API Anda.
 */
export function formatIpInfo(ip, port, info = {}) {
  // common fallback fields
  const isp = info.isp || info.org || info.provider || '-';
  const country = info.country || info.country_name || info.country_name_long || '-';
  const city = info.city || '-';
  const asn = info.asn || info.as || info.autonomous_system || '-';
  // some APIs return ping/delay, some not
  const delay = info.delay_ms ?? info.ping ?? info.latency ?? '-';

  return (
    `📌 *Informasi Alamat IP*\n\n` +
    `🌐 Proxy Host : ${ip}\n` +
    `🔌 Proxy Port : ${port}\n` +
    `🛰️ Origin IP   : ${info.ip || ip}\n` +
    `🏢 ISP        : ${isp}\n` +
    `🌍 Negara     : ${country}\n` +
    `🏙️ Kota       : ${city}\n` +
    `🔢 ASN        : ${asn}\n` +
    `⏱️ Delay      : ${delay} ms\n\n` +
    `🔒 Jika ingin buat konfigurasi, pilih di bawah.`
  );
}
