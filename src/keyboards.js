// src/keyboards.js
// ✨ Semua export yang dibutuhkan bot.js + keyboard proxy & pagination.

// ====== Konstanta pagination ======
export const COUNTRY_PAGE_SIZE = 4; // ubah ke 6 jika mau 6 negara per halaman
export const PROXY_PAGE_SIZE   = 6; // jumlah ip/port per halaman

// ====== Util ======
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ====== Menu utama & turunan lama (tetap supaya kompatibel) ======
export const K_MAIN = {
  inline_keyboard: [
    [{ text: '📱 Menu User',  callback_data: 'OPEN_CMD|/menu_user' }],
    [{ text: '⚙️ Menu Admin', callback_data: 'OPEN_CMD|/menu_admin' }],
  ],
};

export function K_USER() {
  return {
    inline_keyboard: [
      [{ text: '🎲 Random Proxy',      callback_data: 'OPEN_CMD|/random_proxy' }],
      [{ text: '🌍 Proxy per Negara',  callback_data: 'OPEN_CMD|/proxyip' }],
      [
        { text: '🚀 Speedtest',        callback_data: 'OPEN_CMD|/speedtest' },
        { text: '📊 Bandwidth',        callback_data: 'OPEN_CMD|/bandwidth' }
      ],
      [{ text: '📦 Show Pool Count',   callback_data: 'OPEN_CMD|/show_pool_count' }],
      [{ text: '⬅️ Kembali',           callback_data: 'OPEN_CMD|/menu' }],
    ],
  };
}

export function K_ADMIN() {
  return {
    inline_keyboard: [
      [{ text: '📣 Broadcast',         callback_data: 'OPEN_CMD|/broadcast' }],
      [{ text: '📈 Stats 7 Hari',      callback_data: 'OPEN_CMD|/stats7' }],
      [{ text: '🧰 Kelola Pool Proxy', callback_data: 'OPEN_CMD|/proxyip' }],
      [{ text: '⬅️ Kembali',           callback_data: 'OPEN_CMD|/menu' }],
    ],
  };
}

// ====== Keyboard daftar negara (paginate) ======
export function K_countryList(countryCodes = [], page = 0) {
  const pages = chunk(countryCodes, COUNTRY_PAGE_SIZE);
  const real  = pages[page] || [];
  const rows  = real.map(code => ([
    { text: code, callback_data: `SELECT_COUNTRY|${code}` }
  ]));

  const nav = [];
  if (page > 0)                  nav.push({ text: '⬅️ Prev', callback_data: `COUNTRY_PAGE|${page - 1}` });
  if (page < pages.length - 1)   nav.push({ text: 'Next ➡️', callback_data: `COUNTRY_PAGE|${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: '🔙 Tutup', callback_data: 'CLOSE' }]);
  return { inline_keyboard: rows };
}

// ====== Keyboard daftar proxy (paginate) ======
export function K_proxyList(country = '', proxies = [], page = 0) {
  const pages = chunk(proxies, PROXY_PAGE_SIZE);
  const real  = pages[page] || [];
  const rows  = real.map((entry, i) => ([
    { text: entry, callback_data: `SELECT_PROXY|${country}|${page * PROXY_PAGE_SIZE + i}` }
  ]));

  const nav = [];
  if (page > 0)                  nav.push({ text: '⬅️ Prev', callback_data: `PROXY_PAGE|${country}|${page - 1}` });
  if (page < pages.length - 1)   nav.push({ text: 'Next ➡️', callback_data: `PROXY_PAGE|${country}|${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: '🔙 Kembali', callback_data: 'OPEN_CMD|/proxyip' }]);
  return { inline_keyboard: rows };
}

// Alias agar impor lama di bot.js tetap jalan:
export const K_proxyPage = K_proxyList;

// ====== Aksi setelah pilih 1 IP ======
export function K_proxyActions(ipport = '') {
  return {
    inline_keyboard: [
      [
        { text: 'Buat VLESS ⚡',  callback_data: `MAKE_VLESS|${ipport}` },
        { text: 'Buat TROJAN ⚔️', callback_data: `MAKE_TROJAN|${ipport}` }
      ],
      [{ text: '🔙 Kembali', callback_data: 'OPEN_CMD|/proxyip' }],
    ],
  };
}
