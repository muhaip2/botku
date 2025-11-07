// src/keyboards.js

// ===== Menu utama / user / admin =====
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

// ===== util =====
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ===== List negara (paging 6 per halaman, 2 kolom) =====
export const COUNTRY_PAGE_SIZE = 6;

export function K_countryList(countries, page = 1, totalPages = 1) {
  const rows = chunk(
    countries.map(c => ({
      text: `${c.name} ${c.code} ${c.count ? `(${c.count})` : ''}`.trim(),
      callback_data: `COUNTRY_PICK|${c.code}|${page}`
    })),
    2
  );

  const kb = { inline_keyboard: rows };

  if (totalPages > 1) {
    kb.inline_keyboard.push([
      { text: '⏮️', callback_data: `COUNTRY_NAV|first` },
      { text: '◀️',  callback_data: `COUNTRY_NAV|prev` },
      { text: `Hal ${page}/${totalPages}`, callback_data: 'NOOP' },
      { text: '▶️',  callback_data: `COUNTRY_NAV|next` },
      { text: '⏭️', callback_data: `COUNTRY_NAV|last` },
    ]);
  }

  kb.inline_keyboard.push([{ text: '⬅️ Kembali', callback_data: 'OPEN_CMD|/menu_user' }]);
  return kb;
}

// ===== List proxy per negara (paging 6 per halaman, 2 kolom) =====
export const PROXY_PAGE_SIZE = 6;

export function K_proxyList(proxies, countryCode, page = 1, totalPages = 1) {
  const rows = chunk(
    proxies.map(p => ({
      text: `${p.ip}:${p.port}`,
      callback_data: `PROXY_PICK|${countryCode}|${p.ip}|${p.port}|${page}`
    })),
    2
  );

  const kb = { inline_keyboard: rows };

  if (totalPages > 1) {
    kb.inline_keyboard.push([
      { text: '⏮️', callback_data: `PROXY_NAV|${countryCode}|first` },
      { text: '◀️',  callback_data: `PROXY_NAV|${countryCode}|prev` },
      { text: `Hal ${page}/${totalPages}`, callback_data: 'NOOP' },
      { text: '▶️',  callback_data: `PROXY_NAV|${countryCode}|next` },
      { text: '⏭️', callback_data: `PROXY_NAV|${countryCode}|last` },
    ]);
  }

  kb.inline_keyboard.push([
    { text: '⬅️ Kembali Negara', callback_data: 'OPEN_CMD|/proxyip' },
    { text: '🏠 Menu',            callback_data: 'OPEN_CMD|/menu_user' },
  ]);
  return kb;
}

// ===== Aksi setelah pilih 1 IP =====
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
