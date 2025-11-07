// src/kv.js
import {
  STATS_GLOBAL,
  STATS_DAILY_PREFIX,
  STATS_USER_PREFIX,
  SUBSCRIBERS_KEY,
  todayKeyUTC,
} from './settings.js';

// Helper pembungkus KV Pages
const KV = {
  async get(env, key) {
    const v = await env.BOT_DATA.get(key);
    return v ? JSON.parse(v) : null;
  },
  async set(env, key, value) {
    await env.BOT_DATA.put(key, JSON.stringify(value));
  }
};

// Tambah subscriber (set unik)
export async function addSubscriber(env, userId) {
  const key = SUBSCRIBERS_KEY;
  const set = (await KV.get(env, key)) || [];
  if (!set.includes(userId)) {
    set.push(userId);
    await KV.set(env, key, set);
    return true; // baru ditambahkan
  }
  return false;  // sudah ada
}

// Pastikan totalUsers di STATS_GLOBAL sinkron dengan jumlah subscriber
export async function ensureTotalUsers(env) {
  const subs = (await KV.get(env, SUBSCRIBERS_KEY)) || [];
  const g = (await KV.get(env, STATS_GLOBAL)) || { totalMessages: 0, totalUsers: 0 };
  g.totalUsers = subs.length;
  await KV.set(env, STATS_GLOBAL, g);
  return g.totalUsers;
}

// Tracking statistik pesan/command per user + harian
export async function statsTrack(env, userId, username, chatType, cmd = 'message') {
  const dayKey  = STATS_DAILY_PREFIX + todayKeyUTC();
  const userKey = STATS_USER_PREFIX + userId;

  // Global
  const g = (await KV.get(env, STATS_GLOBAL)) || { totalMessages: 0, totalUsers: 0 };
  g.totalMessages++;
  g.lastSeenAt = new Date().toISOString();
  await KV.set(env, STATS_GLOBAL, g);

  // Per user
  const u = (await KV.get(env, userKey)) || { messages: 0, commands: {}, firstSeenAt: new Date().toISOString() };
  u.messages++;
  u.username = username || u.username || '';
  u.lastSeenAt = new Date().toISOString();
  u.commands[cmd] = (u.commands[cmd] || 0) + 1;
  await KV.set(env, userKey, u);

  // Harian
  const d = (await KV.get(env, dayKey)) || { messages: 0, private: 0, group: 0 };
  d.messages++;
  // ⛳️ perbaikan dari error “Invalid assignment target”
  if (String(chatType) === 'private') {
    d.private = (d.private || 0) + 1;
  } else {
    d.group = (d.group || 0) + 1;
  }
  d.updatedAt = new Date().toISOString();
  await KV.set(env, dayKey, d);
}
