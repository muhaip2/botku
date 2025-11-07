// src/kv.js
// Utilitas akses Cloudflare KV + fungsi yang dipakai modul lain.

import { KV_TRAFFIC_DAILY } from './settings.js';

/** Ambil binding KV dari env Pages Functions. */
export function KV(env) {
  // Pastikan Anda sudah membuat binding KV bernama BOT_DATA di Pages → Functions → Bindings
  return env.BOT_DATA;
}

/** Helper get JSON dari KV. */
async function kvGetJSON(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Helper set JSON ke KV. */
async function kvSetJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

/** Tambahkan subscriber baru (unik per chatId). */
export async function addSubscriber(env, chatId) {
  const kv = KV(env);
  const key = `subs:${chatId}`;
  const existed = await kv.get(key);
  if (!existed) {
    // simpan penanda
    await kv.put(key, '1');

    // naikan totalUsers
    const totalKey = 'stats:totalUsers';
    const total = parseInt((await kv.get(totalKey)) || '0', 10) || 0;
    await kv.put(totalKey, String(total + 1));
  }
  return true;
}

/** Pastikan key totalUsers ada; bila belum, inisialisasi 0. */
export async function ensureTotalUsers(env) {
  const kv = KV(env);
  const totalKey = 'stats:totalUsers';
  if (!(await kv.get(totalKey))) {
    await kv.put(totalKey, '0');
  }
}

/** Format YYYY-MM-DD (UTC) untuk penanda hari. */
function todayUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Catat trafik harian per jenis chat (private / group).
 * Menulis ke key KV_TRAFFIC_DAILY dengan isi:
 * { date, private, group, total }
 */
export async function statsTrack(env, chatType) {
  const kv = KV(env);
  const key = KV_TRAFFIC_DAILY;

  const today = todayUTC();
  let data = await kvGetJSON(kv, key, null);

  if (!data || data.date !== today) {
    data = { date: today, private: 0, group: 0, total: 0 };
  }

  // Jangan gunakan (cond ? a : b)++ karena akan error "Invalid assignment target".
  if (String(chatType) === 'private') {
    data.private += 1;
  } else {
    data.group += 1;
  }
  data.total += 1;

  await kvSetJSON(kv, key, data);
  return data;
}
