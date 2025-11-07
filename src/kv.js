// Helper KV <-> JSON
async function kvGetJSON(env, key, fallback) {
  const raw = await env.BOT_DATA.get(key);
  if (!raw) return structuredClone(fallback);
  try { return JSON.parse(raw); } catch { return structuredClone(fallback); }
}
async function kvPutJSON(env, key, value) {
  await env.BOT_DATA.put(key, JSON.stringify(value));
}

/** Ekspor util sebagai objek KV agar import `{ KV }` valid */
export const KV = {
  async get(env, key) { return env.BOT_DATA.get(key); },
  async put(env, key, val) { return env.BOT_DATA.put(key, val); },
  getJSON: kvGetJSON,
  putJSON: kvPutJSON,
};

/** Pastikan counter total user ada */
export async function ensureTotalUsers(env) {
  const raw = await env.BOT_DATA.get('total_users');
  if (!raw) {
    await env.BOT_DATA.put('total_users', '0');
    return 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Tambah subscriber baru */
export async function addSubscriber(env, chatId) {
  const key = 'subscribers';
  const list = await kvGetJSON(env, key, []);
  if (!list.includes(chatId)) {
    list.push(chatId);
    await kvPutJSON(env, key, list);

    const current = await ensureTotalUsers(env);
    await env.BOT_DATA.put('total_users', String(current + 1));
  }
  return true;
}

/** Catat trafik harian berdasarkan tipe chat */
export async function statsTrack(env, chatType) {
  const key = 'stats:traffic:today';
  const today = new Date().toISOString().slice(0, 10);

  let data = await kvGetJSON(env, key, {
    date: today, private: 0, group: 0, total: 0,
  });

  if (data.date !== today) {
    data = { date: today, private: 0, group: 0, total: 0 };
  }

  // FIX: jangan increment pada hasil ternary
  if (String(chatType) === 'private') data.private += 1;
  else data.group += 1;
  data.total += 1;

  await kvPutJSON(env, key, data);
  return data;
    }
