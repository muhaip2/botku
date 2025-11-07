// src/pool.js
// Pool proxy + cache country counts + helper untuk ambil IP per negara

import { fetchMeta } from './meta.js';

/* ====================== KV ====================== */
const KV_REMOTE_POOL   = 'pool:remote:v1';       // { updatedAt, list:[] }
const KV_COUNTRY_CACHE = 'country:counts:v1';    // { updatedAt, ttlSec, list:[{cc,flag,count}] }

const KV = {
  async get(env, key) {
    const raw = await env.BOT_DATA.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  set(env, key, val) {
    return env.BOT_DATA.put(key, JSON.stringify(val));
  }
};

/* ====================== utils ====================== */
const ts = () => Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parsePoolText(text) {
  return text.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('#'));
}
function parseIPPort(s) {
  const [ip, port] = s.split(':');
  return { ip, port: port ?? '443' };
}
function ipValid(ip) {
  const v4 = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const v6 = /^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;
  return v4.test(ip) || v6.test(ip);
}
function portValid(p) {
  const n = Number(p);
  return Number.isInteger(n) && n > 0 && n <= 65535;
}
function ccToFlag(cc) {
  const A = 0x1F1E6;
  const c = cc.toUpperCase();
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65)) +
         String.fromCodePoint(A + (c.charCodeAt(1) - 65));
}

/* ====================== fetch remote ====================== */
async function fetchRemotePool(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('remote pool fetch failed: ' + r.status);
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const j = await r.json();
    if (Array.isArray(j)) return j.map(String);
    if (j && Array.isArray(j.list)) return j.list.map(String);
    throw new Error('bad json for pool');
  }
  return parsePoolText(await r.text());
}

/* ====================== public API ====================== */
export async function mergedPool(settings, env, { refresh = false } = {}) {
  const local = settings.PROXY_POOL || [];
  let remote = [];

  if (settings.PROXY_POOL_URL) {
    const cached = await KV.get(env, KV_REMOTE_POOL);
    const now = ts();

    if (!refresh && cached && (now - (cached.updatedAt || 0) < settings.PROXY_POOL_TTL * 1000)) {
      remote = cached.list || [];
    } else {
      try {
        remote = await fetchRemotePool(settings.PROXY_POOL_URL);
        await KV.set(env, KV_REMOTE_POOL, { updatedAt: now, list: remote });
      } catch {
        remote = cached?.list || [];
      }
    }
  }

  return Array.from(new Set([...local, ...remote]));
}

export async function getCountryCountsCached(env) {
  const cache = await KV.get(env, KV_COUNTRY_CACHE);
  return cache?.list || null;
}

export async function refreshCountryCounts(s, env) {
  const pool = await mergedPool(s, env, {});
  const map = new Map(); // cc -> { cc, flag, count }

  for (const raw of pool) {
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const m = await fetchMeta(s, ip, port);

      // derive cc
      let cc = '';
      if (m.flag) {
        const cps = [...m.flag].map(ch => ch.codePointAt(0));
        if (cps.length === 2) {
          const A = 0x1F1E6;
          cc = String.fromCharCode(65 + (cps[0] - A)) + String.fromCharCode(65 + (cps[1] - A));
        }
      }
      if (!cc && m.country && m.country.length >= 2) cc = m.country.slice(0, 2).toUpperCase();
      if (!cc) continue;

      const cur = map.get(cc) || { cc, flag: m.flag || ccToFlag(cc), count: 0 };
      cur.count++;
      map.set(cc, cur);
    } catch {
      // ignore
    }

    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }

  let list = Array.from(map.values()).sort((a, b) => b.count - a.count);
  if (s.COUNTRY_LIST_LIMIT > 0) list = list.slice(0, s.COUNTRY_LIST_LIMIT);

  await KV.set(env, KV_COUNTRY_CACHE, {
    updatedAt: ts(),
    ttlSec: s.COUNTRY_CACHE_TTL,
    list
  });

  return list;
}

export async function countryActiveIPs(s, env, cc, want = 6) {
  const pool = await mergedPool(s, env, {});
  const out = [];
  const flag = ccToFlag(cc);

  for (const raw of pool) {
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const m = await fetchMeta(s, ip, port);
      const match = (m.flag === flag) ||
                    (m.country && m.country.toUpperCase().startsWith(cc));
      if (match) {
        out.push(`${ip}:${port}`);
        if (out.length >= want) break;
      }
    } catch {
      // ignore
    }

    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }

  return out;
}

/** Random list dengan meta: [{ip,port,meta}] */
export async function randomProxyList(s, env, count = 10) {
  const pool = await mergedPool(s, env, {});
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const out = [];

  for (const raw of shuffled) {
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const m = await fetchMeta(s, ip, port);
      out.push({ ip, port, meta: m });
    } catch {
      // skip
    }

    if (out.length >= count) break;
    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }

  return out;
      }
