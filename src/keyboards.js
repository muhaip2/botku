// src/keyboards.js
export function K_MAIN() { /* sudah ada */ }
export function K_USER() { /* sudah ada */ }
export function K_ADMIN() { /* sudah ada */ }

// ====== Tambahan ======
export const COUNTRY_PAGE_SIZE = 6;      // ganti 4 jika mau 4 per halaman
export const PROXY_PAGE_SIZE   = 10;     // banyak IP per halaman

// list: [{ code:'US', name:'United States', count:123 }, ...]
export function K_countryList(list, page = 1, pageSize = COUNTRY_PAGE_SIZE) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  const slice = list.slice(start, start + pageSize);

  const rows = slice.map(c => ([
    { text: `${flag(c.code)} ${c.name} (${c.count})`,
      callback_data: `C_PICK|${c.code}|1` } // page=1 utk daftar IP
  ]));

  // baris navigasi
  const nav = [];
  if (p > 1) nav.push({ text: '⬅️ Sebelumnya', callback_data: `C_LIST|${p - 1}` });
  nav.push({ text: `📄 ${p}/${pages}`, callback_data: 'C_NOP' });
  if (p < pages) nav.push({ text: 'Berikutnya ➡️', callback_data: `C_LIST|${p + 1}` });
  if (nav.length) rows.push(nav);

  // tombol kembali ke menu user
  rows.push([{ text: '↩️ Kembali', callback_data: 'OPEN_CMD|/menu_user' }]);

  return { inline_keyboard: rows };
}

// ips: array of strings, e.g. ["1.2.3.4:443", ...]
export function K_proxyPage(code, page = 1, pageSize = PROXY_PAGE_SIZE) {
  const nav = [];
  if (page > 1) nav.push({ text: '⬅️ Sebelumnya', callback_data: `P_PAGE|${code}|${page - 1}` });
  nav.push({ text: `📄 ${page}`, callback_data: 'C_NOP' });
  nav.push({ text: 'Berikutnya ➡️', callback_data: `P_PAGE|${code}|${page + 1}` });

  return {
    inline_keyboard: [
      nav,
      [{ text: '↩️ Daftar Negara', callback_data: 'C_LIST|1' }]
    ]
  };
}

// helper bendera sederhana (ISO 3166-1 alpha-2)
function flag(code) {
  try {
    const A = 0x1F1E6;
    const a = 'A'.charCodeAt(0);
    const c1 = code[0].toUpperCase().charCodeAt(0) - a + A;
    const c2 = code[1].toUpperCase().charCodeAt(0) - a + A;
    return String.fromCodePoint(c1, c2);
  } catch { return '🌐'; }
      }
