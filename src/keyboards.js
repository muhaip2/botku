// src/keyboards.js
// Helper keyboard untuk menampilkan daftar negara / proxy + pagination
export const perPageCountries = 4; // ubah jadi 6 kalau mau 6 negara per halaman
export const perPageProxies = 6;   // jumlah ip/port per halaman

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * K_countryList(countryCodes, page)
 * - countryCodes: array of country codes (string)
 * - page: zero-based page index
 */
export function K_countryList(countryCodes = [], page = 0) {
  const pages = chunkArray(countryCodes, perPageCountries);
  const real = pages[page] || [];
  const rows = real.map(code => [{ text: code, callback_data: `SELECT_COUNTRY|${code}` }]);

  // pagination buttons
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `COUNTRY_PAGE|${page - 1}` });
  if (page < pages.length - 1) nav.push({ text: 'Next ➡️', callback_data: `COUNTRY_PAGE|${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: '🔙 Tutup', callback_data: 'CLOSE' }]);
  return { inline_keyboard: rows };
}

/**
 * K_proxyList(country, proxies, page)
 * - country: country code
 * - proxies: array of strings "ip:port"
 */
export function K_proxyList(country = '', proxies = [], page = 0) {
  const pages = chunkArray(proxies, perPageProxies);
  const real = pages[page] || [];
  const rows = real.map((entry, i) => [{ text: entry, callback_data: `SELECT_PROXY|${country}|${page * perPageProxies + i}` }]);

  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ Prev', callback_data: `PROXY_PAGE|${country}|${page - 1}` });
  if (page < pages.length - 1) nav.push({ text: 'Next ➡️', callback_data: `PROXY_PAGE|${country}|${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: '🔙 Kembali', callback_data: 'OPEN_CMD|/proxyip' }]);
  return { inline_keyboard: rows };
}

/**
 * K_proxyActions(ipport)
 * - ipport: "ip:port"
 */
export function K_proxyActions(ipport = '') {
  return {
    inline_keyboard: [
      [
        { text: 'Buat VLESS ⚡', callback_data: `MAKE_VLESS|${ipport}` },
        { text: 'Buat TROJAN ⚔️', callback_data: `MAKE_TROJAN|${ipport}` }
      ],
      [{ text: '🔙 Kembali', callback_data: 'OPEN_CMD|/proxyip' }]
    ]
  };
}
