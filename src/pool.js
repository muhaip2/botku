// src/pool.js — TAMBAHKAN fungsi di bawah ini (atau REPLACE versi lama)
// Pastikan file ini juga mengekspor fungsi lain yang dipakai seperti
// getCountryCounts, countryActiveIPs, mergedPool, dll.

export async function randomProxyList(s, env, count) {
  const pool = await mergedPool(s, env, {});
  // acak ringan
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);

  const out = [];
  for (const raw of shuffled) {
    const { ip, port } = parseIPPort(raw);
    if (!ipValid(ip) || !portValid(port)) continue;

    try {
      const meta = await fetchMeta(s, ip, port); // {flag, isp, country, delay, ...}
      out.push({ ip, port, meta });
    } catch {
      // diamkan saja kalau 1 IP gagal
    }

    if (out.length >= count) break;
    if (s.REQ_DELAY_MS > 0) await sleep(s.REQ_DELAY_MS);
  }
  return out;
}
