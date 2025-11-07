// src/pool.js
// Utility ringan
const ts = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Ambil konstanta dari settings
import {
  KV_REMOTE_POOL,
  KV_COUNTRY_CACHE,
} from './settings.js';

// ==== Helper parsing pool ====
function parsePoolText(text) {
  return text.split(/\r?\n|,/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
}
async function fetchRemotePool(s) {
  const r = await fetch(s.PROXY_POOL_URL);
  if (!r.ok) throw new Error('remote fail '+r.status);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const j = await r.json();
    if (Array.isArray(j)) return j.map(String);
    if (j && Array.isArray(j.list)) return j.list.map(String);
    throw new Error('bad json');
  }
  return parsePoolText(await r.text());
}
const KV = {
  async get(env, key){ const raw = await env.BOT_DATA.get(key); if (!raw) return null; try{ return JSON.parse(raw); } catch { return null; } },
  set(env, key, val){ return env.BOT_DATA.put(key, JSON.stringify(val)); }
};

// ==== Pool merger (local + remote cache) ====
async function mergedPool(s, env, { refresh = false } = {}) {
  const local = s.PROXY_POOL || [];
  let remote = [];
  if (s.PROXY_POOL_URL) {
    const cached = await KV.get(env, KV_REMOTE_POOL);
    const now = ts();
    if (!refresh && cached && (now - (cached.updatedAt || 0) < s.PROXY_POOL_TTL * 1000)) {
      remote = cached.list || [];
    } else {
      try {
        remote = await fetchRemotePool(s);
        await KV.set(env, KV_REMOTE_POOL, { updatedAt: now, list: remote });
      } catch {
        remote = (cached?.list) || [];
      }
    }
  }
  return Array.from(new Set([...local, ...remote]));
}

// ==== IP helpers ====
function parseIPPort(s) {
  const p = s.split(':');
  return p.length === 2 ? { ip: p[0], port: p[1] } : { ip: s, port: '443' };
}
function ipValid(ip){
  const v4=/^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const v6=/^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;
  return v4.test(ip) || v6.test(ip);
}
function portValid(p){ const n = Number(p); return Number.isInteger(n) && n>0 && n<=65535; }

// ==== Meta API ====
async function fetchMeta(s, ip, port) {
  const r = await fetch(s.API_URL + encodeURIComponent(ip) + ':' + encodeURIComponent(port));
  if (!r.ok) throw new Error('meta fail');
  return r.json();
}
const A = 0x1F1E6;
const ccToFlag = (cc) => String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(0) - 65)) + String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(1) - 65));
function flagToCC(flag){
  try{
    const cps = [...flag].map(c=>c.codePointAt(0));
    if (cps.length === 2) {
      return String.fromCharCode(65 + (cps[0]-A)) + String.fromCharCode(65 + (cps[1]-A));
    }
  }catch{}
  return '';
}

// ===================================================================
// ===============  EXPORTS DIPAKAI OLEH FILE LAIN  ==================
// ===================================================================

// 1) Cache counts negara (dipakai list negara di UI)
export async function getCountryCountsCached(s, env){
  const cache = await KV.get(env, KV_COUNTRY_CACHE);
  const now = ts();
  if (cache && now - (cache.updatedAt || 0) < (s.COUNTRY_CACHE_TTL * 1000)) {
    return cache.list;
  }
  return await refreshCountryCounts(s, env);
}

// 2) Force refresh scan negara & simpan cache
export async function refreshCountryCounts(s, env){
  const pool = await mergedPool(s, env, {});
  const map = new Map(); // cc -> {cc, flag, count}

  for (const raw of pool){
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const m = await fetchMeta(s, ip, port);
      let cc = flagToCC(m.flag || '') || (m.country ? m.country.slice(0,2).toUpperCase() : '');
      if (!cc) continue;
      const cur = map.get(cc) || { cc, flag: (m.flag || ccToFlag(cc)), count: 0 };
      cur.count++;
      map.set(cc, cur);
    } catch {}
    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }

  let list = Array.from(map.values()).sort((a,b)=>b.count - a.count);
  if (s.COUNTRY_LIST_LIMIT > 0) list = list.slice(0, s.COUNTRY_LIST_LIMIT);

  await KV.set(env, KV_COUNTRY_CACHE, { updatedAt: ts(), ttlSec: s.COUNTRY_CACHE_TTL, list });
  return list;
}

// 3) Ambil IP aktif untuk negara tertentu (maksimal `want`)
export async function countryActiveIPs(s, env, cc, want = 6){
  const pool = await mergedPool(s, env, {});
  const out = [];
  const targetCC = (cc || '').toUpperCase();

  for (const raw of pool){
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const m = await fetchMeta(s, ip, port);
      const ccFromFlag = flagToCC(m.flag || '');
      const match = (ccFromFlag === targetCC) ||
                    (m.country && m.country.toUpperCase().startsWith(targetCC));
      if (match) {
        out.push(`${ip}:${port}`);
        if (out.length >= want) break;
      }
    } catch {}
    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}

// 4) Daftar proxy acak (untuk /random_proxy)
export async function randomProxyList(s, env, count){
  const pool = await mergedPool(s, env, {});
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const out = [];

  for (const raw of shuffled){
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const meta = await fetchMeta(s, ip, port);
      out.push({ ip, port, meta });
    } catch {}
    if (out.length >= count) break;
    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
  }
