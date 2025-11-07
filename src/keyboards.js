// src/keyboards.js
// Kumpulan inline keyboard Telegram

// Menu utama: tombol untuk membuka perintah lewat callback,
// nanti ditangani di bot.js (router "OPEN_CMD|/perintah")
export const K_MAIN = {
  inline_keyboard: [
    [{ text: '📱 Menu User',  callback_data: 'OPEN_CMD|/menu_user' }],
    [{ text: '⚙️ Menu Admin', callback_data: 'OPEN_CMD|/menu_admin' }],
  ]
};

// Menu user (boleh modif labelnya sesuai kebutuhan)
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

// Menu admin (contoh sederhana; tambah sesuai fiturmu)
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
