// src/kv.js
// Pembungkus Cloudflare KV + helper statistik/subscribers

import {
  KV_SUBS,
  STATS_GLOBAL,
  STATS_DAILY_PREFIX,
  STATS_USER_PREFIX
} from './settings.js';

// Ekspor objek KV bila ada modul yang ingin akses langsung
export const KV = {
  async get(env, key) {
    const raw = await env.BOT_DATA.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  set(env, key, val) {
    return env.BOT_DATA.put(key, JSON.stringify(val));
  },
  async list(env, prefix) {
    let cursor;
    const keys = [];
    // iterasi sampai habis
    // (dipakai beberapa util, aman kalau belum dibutuhkan)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await env.BOT_DATA.list({ prefix, cursor });
      keys.push(...r.keys.map(k => k.name));
      if (r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
    return keys;
  }
};

// Tambah subscriber unik
export async function addSubscriber(env, chatId) {
  const set = new Set((await KV.get(env, KV_SUBS)) || []);
  set.add(String(chatId));
  await KV.set(env, KV_SUBS, Array.from(set));
}

// Catat statistik global / user / harian
export async function statsTrack(env, userId, username, chatType, cmd = 'message') {
  const todayKey = (() => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  })();

  // Global
  const g = (await KV.get(env, STATS_GLOBAL)) || { totalMessages: 0, totalUsers: 0 };
  g.totalMessages++;
  g.lastSeenAt = new Date().toISOString();
  await KV.set(env, STATS_GLOBAL, g);

  // User
  const uKey = STATS_USER_PREFIX + userId;
  const u = (await KV.get(env, uKey)) || {
    messages: 0,
    commands: {},
    firstSeenAt: new Date().toISOString()
  };
  u.messages++;
  u.username = username || u.username || '';
  u.lastSeenAt = new Date().toISOString();
  u.commands[cmd] = (u.commands[cmd] || 0) + 1;
  await KV.set(env, uKey, u);

  // Harian
  const dKey = STATS_DAILY_PREFIX + todayKey;
  const d = (await KV.get(env, dKey)) || { messages: 0, private: 0, group: 0 };
  d.messages++;
  (chatType === 'private' ? d.private : d.group)++;
  await KV.set(env, dKey, d);
}

// Sinkronkan totalUsers = jumlah subs unik
export async function ensureTotalUsers(env) {
  const subs = new Set((await KV.get(env, KV_SUBS)) || []);
  const g = (await KV.get(env, STATS_GLOBAL)) || { totalMessages: 0, totalUsers: 0 };
  g.totalUsers = subs.size;
  await KV.set(env, STATS_GLOBAL, g);
}
