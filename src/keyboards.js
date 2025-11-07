// src/keyboards.js
// Kumpulan inline keyboard Telegram + helper paging

// =============== Menu Utama / User / Admin ===============
export const K_MAIN = {
  inline_keyboard: [
    [{ text: '📱 Menu User',  callback_data: 'OPEN_CMD|/menu_user' }],
    [{ text: '⚙️ Menu Admin', callback_data: 'OPEN_CMD|/menu_admin' }],
  ]
};

export function K_USER() {
  return {
    inline_keyboard: [
      [{ text: '🎲 Random Proxy',      callback_data: 'OPEN_CMD|/random_proxy' }],
      [{ text: '🌍 Proxy per Negara',  callback_data: 'OPEN_CMD|/proxyip' }],
      [
        { text: '🚀 Speedtest',  callback_data: 'OPEN_CMD|/speedtest' },
        { text: '📶 Bandwidth',  callback_data: 'OPEN_CMD|/bandwidth' },
      ],
      [{ text: '📦 Show Pool Count',   callback_data: 'OPEN_CMD|/pool_count' }],
      [{ text: '⬅️ Kembali',           callback_data: 'OPEN_CMD|/menu' }],
    ]
  };
}

export function K_ADMIN() {
  return {
    inline_keyboard: [
      [{ text: '📰 Broadcast',         callback_data: 'OPEN_CMD|/broadcast' }],
      [{ text: '📊 Stats 7 Hari',      callback_data: 'OPEN_CMD|/stats7' }],
      [{ text: '🧰 Kelola Pool Proxy', callback_data: 'OPEN_CMD|/pool' }],
      [{ text: '⬅️ Kembali',           callback_data: 'OPEN_CMD|/menu' }],
    ]
  };
}

// =============== Helper umum ===============
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// =============== Paging Negara (4 atau 6 item per halaman) ===============
const COUNTRY_PER_PAGE = 6;

/**
 * @param {Array<{code:string,name:string,count?:number}>} countries
 * @param {number} page index mulai 1
 * @param {number} totalPages total halaman
 */
export function K_countryList(countries, page = 1, totalPages = 1) {
  // Tampilkan tombol 2 kolom x 2/3 baris (total max 4 atau 6)
  const rows = chunk(
    countries.map(c => ({
      text: `${c.name} ${c.code} ${c.count ? `(${c.count})` : ''}`.trim(),
      callback_data: `COUNTRY_PICK|${c.code}|${page}`
    })),
    2
  );

  // Navigasi halaman
  const nav = [];
  if (totalPages > 1) {
    nav.push(
      { text: '⏮️', callback_data: `COUNTRY_NAV|first` },
      { text: '◀️', callback_data: `COUNTRY_NAV|prev` },
      { text: `Hal ${page}/${totalPages}`, callback_data: 'NOOP' },
      { text: '▶️', callback_data: `COUNTRY_NAV|next` },
      { text: '⏭️', callback_data: `COUNTRY_NAV|last` },
    );
  }
  const kb = { inline_keyboard: rows };
  if (nav.length) kb.inline_keyboard.push(nav);
  kb.inline_keyboard.push([{ text: '⬅️ Kembali', callback_data: 'OPEN_CMD|/menu_user' }]);
  return kb;
}

// =============== Daftar Proxy untuk satu negara (paging) ===============
const PROXY_PER_PAGE = 6;

/**
 * @param {Array<{ip:string,port:number}>} proxies
 * @param {string} countryCode
 * @param {number} page
 * @param {number} totalPages
 */
export function K_proxyList(proxies, countryCode, page = 1, totalPages = 1) {
  const rows = chunk(
    proxies.map(p => ({
      text: `${p.ip}:${p.port}`,
      callback_data: `PROXY_PICK|${countryCode}|${p.ip}|${p.port}|${page}`
    })),
    2
  );

  const kb = { inline_keyboard: rows };

  const nav = [];
  if (totalPages > 1) {
    nav.push(
      { text: '⏮️', callback_data: `PROXY_NAV|${countryCode}|first` },
      { text: '◀️', callback_data: `PROXY_NAV|${countryCode}|prev` },
      { text: `Hal ${page}/${totalPages}`, callback_data: 'NOOP' },
      { text: '▶️', callback_data: `PROXY_NAV|${countryCode}|next` },
      { text: '⏭️', callback_data: `PROXY_NAV|${countryCode}|last` },
    );
    kb.inline_keyboard.push(nav);
  }

  kb.inline_keyboard.push([
    { text: '⬅️ Kembali Negara', callback_data: 'OPEN_CMD|/proxyip' },
    { text: '🏠 Menu',            callback_data: 'OPEN_CMD|/menu_user' },
  ]);
  return kb;
}

// =============== Aksi setelah pilih satu IP (buat VLESS/TROJAN) ===============
/**
 * @param {string} ip
 * @param {number|string} port
 * @param {string} countryCode
 */
export function K_proxyActions(ip, port, countryCode) {
  return {
    inline_keyboard: [
      [
        { text: 'VLESS 🚀',  callback_data: `PROXY_BUILD|vless|${countryCode}|${ip}|${port}` },
        { text: 'TROJAN ⚔️', callback_data: `PROXY_BUILD|trojan|${countryCode}|${ip}|${port}` },
      ],
      [
        { text: '⬅️ Kembali ke List', callback_data: `PROXY_BACK|${countryCode}` },
        { text: '🏠 Menu',            callback_data: 'OPEN_CMD|/menu_user' },
      ]
    ]
  };
}

// (Opsional) ekspor ukuran halaman bila ingin dipakai modul lain
export const COUNTRY_PAGE_SIZE = COUNTRY_PER_PAGE;
export const PROXY_PAGE_SIZE   = PROXY_PER_PAGE;
