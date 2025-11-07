// src/kv.js
// Abstraksi KV + statistik user/global

// ======= KV KEYS (tetap) =======
export const KV_SUBS = 'subs:list';
export const KV_BCAST = 'bcast:cur';
export const KV_REMOTE_POOL = 'pool:remote:v1';
export const KV_COUNTRY_CACHE = 'country:counts:v1';

export const STATS_GLOBAL = 'stats:global';
export const STATS_DAILY_PREFIX = 'stats:daily:';
export const STATS_USER_PREFIX = 'stats:user:';
export const KV_TRAFFIC_DAILY = 'traffic:daily:'; // +YYYYMMDD => { bytesOut }

export const RL_BUCKET_PREFIX = 'rl:bucket:';
export const RL_COOLDOWN_PREFIX = 'rl:cooldown:';

// ======= Helper tanggal sederhana =======
const todayKeyUTC = (off = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + off);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
};
export const todayKey = todayKeyUTC; // jika ada modul lama yang pakai nama ini

// ======= Wrapper KV (namespace BOT_DATA) =======
export const KV = {
  async get(env, key) {
    const raw = await env.BOT_DATA.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  async set(env, key, value) {
    await env.BOT_DATA.put(key, JSON.stringify(value));
  },
  async list(env, prefix) {
    let cursor; const out = [];
    // Pages KV list membutuhkan loop cursor
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await env.BOT_DATA.list({ prefix, cursor });
      out.push(...r.keys.map(k => k.name));
      if (r.list_complete || !r.cursor) break;
      cursor = r.cursor;
    }
    return out;
  },
};

// ======= Trafik payload telegram per hari =======
export async function trackTraffic(env, bytes) {
  const key = KV_TRAFFIC_DAILY + todayKeyUTC();
  const cur = await KV.get(env, key) || { bytesOut: 0 };
  cur.bytesOut = (cur.bytesOut || 0) + Math.max(0, bytes | 0);
  await KV.set(env, key, cur);
}

// ======= Subscribers & Stats =======
export async function addSubscriber(env, chatId) {
  const set = new Set((await KV.get(env, KV_SUBS)) || []);
  set.add(String(chatId));
  await KV.set(env, KV_SUBS, Array.from(set));
}

export async function ensureTotalUsers(env) {
  const set = new Set((await KV.get(env, KV_SUBS)) || []);
  const g = (await KV.get(env, STATS_GLOBAL)) || {};
  g.totalUsers = set.size;
  await KV.set(env, STATS_GLOBAL, g);
}

export async function statsTrack(env, userId, username, chatType, cmd = 'message') {
  const dayKey = STATS_DAILY_PREFIX + todayKeyUTC();
  const userKey = STATS_USER_PREFIX + userId;

  const g = (await KV.get(env, STATS_GLOBAL)) || { totalMessages: 0, totalUsers: 0 };
  g.totalMessages++;
  g.lastSeenAt = new Date().toISOString();
  await KV.set(env, STATS_GLOBAL, g);

  const u = (await KV.get(env, userKey)) || { messages: 0, commands: {}, firstSeenAt: new Date().toISOString() };
  u.messages++;
  u.username = username || u.username || '';
  u.lastSeenAt = new Date().toISOString();
  u.commands[cmd] = (u.commands[cmd] || 0) + 1;
  await KV.set(env, userKey, u);

  const d = (await KV.get(env, dayKey)) || { messages: 0, private: 0, group: 0 };
  d.messages++;
  (String(chatType) === 'private' ? d.private : d.group)++;
  await KV.set(env, dayKey, d);
                                             }
