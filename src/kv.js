// src/kv.js
// Utilitas penyimpanan di Cloudflare KV untuk bot.
// Tambahan: index user + pagination.

const USERS_INDEX_KEY = 'users:index:v1'; // simpan daftar pengguna

// Helper ambil namespace KV.
// Banyak proyek menamai binding KV sebagai "KV". Jika beda, silakan sesuaikan.
function getKV(env) {
  if (env.KV) return env.KV;
  // fallback nama umum lain (opsional)
  if (env.BOT_DATA) return env.BOT_DATA;
  throw new Error('KV namespace not found on env');
}

// ——— Fungsi existing (dummy placeholder agar tidak putus import di file lain).
// Jika di proyekmu sudah ada fungsi-fungsi ini, biarkan tetap dipakai yang lama.
// Di sini kita ekspor supaya kompatibel dengan import yang ada.
export async function addSubscriber(env, chatId) {
  // Jika sudah ada implementasi aslimu, hapus isi ini dan pakai yang lama.
  // Di sini tidak melakukan apa-apa, karena fokus patch ini pada index user terpisah.
  return;
}
export async function statsTrack(env, chatId, username, chatType, eventName) {
  return;
}
export async function ensureTotalUsers(env) {
  return;
}

// ——— Upsert index user
export async function upsertUserIndex(env, { id, name, username }) {
  const KV = getKV(env);

  // ambil index
  const raw = await KV.get(USERS_INDEX_KEY);
  /** @type {{ ids: string[], map: Record<string,{name:string,username:string|null}> }} */
  let idx = raw ? JSON.parse(raw) : { ids: [], map: {} };

  const sid = String(id);
  const uname = username || null;
  const nm = name || '';

  if (!idx.map[sid]) {
    idx.ids.push(sid);
    idx.map[sid] = { name: nm, username: uname };
  } else {
    // update name/username bila berubah
    const cur = idx.map[sid];
    if (cur.name !== nm || cur.username !== uname) {
      idx.map[sid] = { name: nm, username: uname };
    }
  }

  await KV.put(USERS_INDEX_KEY, JSON.stringify(idx), { expirationTtl: undefined });
  return true;
}

// ——— Ambil total user
export async function getUsersTotal(env) {
  const KV = getKV(env);
  const raw = await KV.get(USERS_INDEX_KEY);
  if (!raw) return 0;
  const idx = JSON.parse(raw);
  return Array.isArray(idx.ids) ? idx.ids.length : 0;
}

// ——— Ambil halaman user (10 per halaman default)
export async function getUsersPage(env, page = 1, pageSize = 10) {
  const KV = getKV(env);
  const raw = await KV.get(USERS_INDEX_KEY);
  const idx = raw ? JSON.parse(raw) : { ids: [], map: {} };

  const total = Array.isArray(idx.ids) ? idx.ids.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const start = (p - 1) * pageSize;
  const end = Math.min(start + pageSize, total);

  const sliceIds = idx.ids.slice(start, end);
  const users = sliceIds.map(id => {
    const info = idx.map[id] || {};
    return {
      id,
      name: info.name || '',
      username: info.username || null
    };
  });

  return { page: p, total, totalPages, pageSize, users };
}
