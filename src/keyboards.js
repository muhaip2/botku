// src/keyboards.js
// Kumpulan inline keyboard yang dipakai bot

// ——— Keyboard Utama (di /start atau /menu)
export const K_MAIN = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📱 Menu User',  callback_data: 'OPEN_CMD|/menu_user' }],
      [{ text: '⚙️ Menu Admin', callback_data: 'OPEN_CMD|/menu_admin' }]
    ]
  },
  parse_mode: 'Markdown'
};

// ——— Keyboard Menu User
export function K_USER() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📜 Perintah User', callback_data: 'OPEN_CMD|/help_user' }],
        [{ text: '🎲 Random Proxy',  callback_data: 'OPEN_CMD|/random_proxy' }],
        [
          { text: '🚀 Speedtest',  callback_data: 'OPEN_CMD|/speedtest' },
          { text: '📶 Bandwidth',  callback_data: 'OPEN_CMD|/bandwidth' }
        ],
        [{ text: '📦 Show Pool Count', callback_data: 'OPEN_CMD|/pool_count' }],
        [{ text: '⬅️ Kembali', callback_data: 'OPEN_CMD|/menu' }]
      ]
    },
    parse_mode: 'Markdown'
  };
}

// ——— Keyboard Menu Admin
export function K_ADMIN() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📜 Perintah Admin', callback_data: 'OPEN_CMD|/help_admin' }],
        [{ text: '📰 Broadcast',     callback_data: 'OPEN_CMD|/broadcast' }],
        [{ text: '📊 Stats 7 Hari',   callback_data: 'OPEN_CMD|/stats7' }],
        [{ text: '🟥 Kelola Pool Proxy', callback_data: 'OPEN_CMD|/pool_admin' }],
        [{ text: '⬅️ Kembali', callback_data: 'OPEN_CMD|/menu' }]
      ]
    },
    parse_mode: 'Markdown'
  };
}
