// Cloudflare Worker Telegram Bot
// Fitur: menu User/Admin, cek IP & generate VLESS/TROJAN, random proxy,
// cek kuota (via prompt + ENV API_DOMPUL), bandwidth CF, broadcast teks & gambar,
// list user admin-only, tombol SUPPORT kirim gambar URL.
// Semua secret/konfigurasi via ENV & KV binding: DATA_DB

let CONFIG = {
  TELEGRAM_BOT_TOKEN: '',   
  SERVERVLESS: '',
  SERVERTROJAN: '',
  SERVERWILDCARD: '',
  PASSUID: '',
  API_URL: '',
  API_DOMPUL: '',            // ENV untuk cek kuota/dompet pulsa
  SUPPORT_IMAGE_URL: '',     // ENV gambar support (URL)
  WATERMARK: ' ADMIN t.me/swdstore2',
  ADMIN_IDS: [] // number[]
};

const memoryKV = new Map(); // session ringan (per instance)

// ===== Util umum =====
function parseAdminIds(adminEnv) {
  if (!adminEnv) return [];
  return adminEnv.split(',').map(s => parseInt(s.trim())).filter(Boolean);
}
function isAdmin(id) { return CONFIG.ADMIN_IDS.includes(Number(id)); }
function nowJakartaString() { try { return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); } catch { return new Date().toLocaleString(); } }
function formatJakartaFull() {
  const tz = 'Asia/Jakarta';
  const now = new Date();
  return {
    hari: now.toLocaleDateString('id-ID', { weekday: 'long', timeZone: tz }),
    tgl:  now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }),
    jam:  now.toLocaleTimeString('id-ID', { hour12: false, timeZone: tz })
  };
}

// ===== ENTRY =====
async function handleRequest(request, env) {
  // refresh CONFIG dari env setiap request
  CONFIG.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || CONFIG.TELEGRAM_BOT_TOKEN;
  CONFIG.SERVERVLESS      = env.SERVERVLESS      || CONFIG.SERVERVLESS      || 'vless.example.com';
  CONFIG.SERVERTROJAN     = env.SERVERTROJAN     || CONFIG.SERVERTROJAN     || 'trojan.example.com';
  CONFIG.SERVERWILDCARD   = env.SERVERWILDCARD   || CONFIG.SERVERWILDCARD   || 'wc.example.com';
  CONFIG.PASSUID          = env.PASSUID          || CONFIG.PASSUID          || 'PUT-UUID-HERE';
  CONFIG.API_URL          = env.API_URL          || CONFIG.API_URL          || 'https://ip.example/api?ip=';
  CONFIG.API_DOMPUL       = env.API_DOMPUL       || CONFIG.API_DOMPUL       || 'https://example.com/cek_kuota?msisdn=';
  CONFIG.SUPPORT_IMAGE_URL= env.SUPPORT_IMAGE_URL|| CONFIG.SUPPORT_IMAGE_URL|| 'https://raw.githubusercontent.com/muhaip2/botku/a0421fca48e383cf05a3a49114702c924b571745/Kode%20QR.jpg';
  CONFIG.WATERMARK        = env.WATERMARK        || CONFIG.WATERMARK;
  CONFIG.ADMIN_IDS        = parseAdminIds(env.ADMIN_ID || '');

  try {
    const { pathname } = new URL(request.url);

    if (pathname === '/webhook') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      const update = await request.json();

      // Callback Query (tombol inline)
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env);
        return new Response('OK');
      }

      // Pesan teks / foto / dsb
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const messageText = msg.text || (msg.caption || '') || '';

        // simpan user ke KV
        try {
          await env.DATA_DB.put(String(chatId), JSON.stringify({
            id: chatId,
            first_name: msg.from?.first_name || '',
            last_name:  msg.from?.last_name  || '',
            username:   msg.from?.username   || '',
            updated_at: new Date().toISOString()
          }));
        } catch (e) { console.error('KV put fail:', e); }

        // Admin broadcast gambar via reply foto + caption /broadcastimage
        if (msg.photo && messageText.startsWith('/broadcastimage')) {
          await handleBroadcastImageCommand(chatId, msg, env);
          return new Response('OK');
        }

        // Normalisasi command
        const cmd = (messageText.split(' ')[0] || '').toLowerCase();

        // Start/Menu
        if (cmd === '/start' || cmd === '/star' || cmd === '/menu') {
          await handleStartCommand(chatId, env);
          return new Response('OK');
        }

        // === state "cek kuota" via menu user ===
        const state = memoryKV.get(chatId);
        if (state && state.mode === 'await_quota') {
          memoryKV.delete(chatId);
          const nomorInput = messageText.trim();
          if (!nomorInput || nomorInput.startsWith('/')) {
            await sendMessage(chatId, "❌ Nomor tidak valid. Ulangi tekan *cek kuota* di Menu User ya.");
          } else {
            await handleCekQuotaCommand(chatId, `.cek ${nomorInput}`);
          }
          return new Response('OK');
        }

        // Perintah lain
        if (messageText === '.ping') {
          await pingCrot(chatId);
        } else if (messageText === '/getrandomproxy') {
          await handleGetRandomProxy(chatId);
        } else if (messageText.startsWith('.cek')) {
          await handleCekQuotaCommand(chatId, messageText);
        } else if (messageText.startsWith('/bandwidth')) {
          await handleBandwidthCommand(chatId, env);
        } else if (messageText.startsWith('/listuser')) {
          await handleListUserCommand(chatId, env);
        } else if (messageText.startsWith('/userdetail')) {
          await handleUserDetailCommand(chatId, messageText, env);
        } else if (messageText.startsWith('/broadcast ')) {
          await handleBroadcastCommand(chatId, messageText, env);
        } else if (messageText.startsWith('/broadcastimage') && !msg.photo) {
          await handleBroadcastImageFromArgs(chatId, messageText, env);
        } else {
          // Jika mirip IP:PORT → cek IP
          if (messageText.includes(':') && messageText.split(':')[0].match(/^[0-9.]+$/)) {
            await processMessage(messageText, chatId);
          } else {
            await sendMessage(chatId, 'Perintah tidak dikenali. Gunakan /menu untuk melihat pilihan.');
          }
        }
      }

      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });

  } catch (error) {
    console.error('Error handleRequest:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ===== START / MENU (welcome baru + tombol Menu User/Admin + SUPPORT) =====
async function handleStartCommand(chatId, env) {
  let name = 'teman', username = '-';
  try {
    const raw = await env.DATA_DB.get(String(chatId));
    if (raw) {
      const u = JSON.parse(raw);
      const gab = `${u.first_name || ''} ${u.last_name || ''}`.trim();
      name = gab || name; username = u.username ? '@' + u.username : '-';
    }
  } catch {}

  const { hari, tgl, jam } = formatJakartaFull();
  const text =
`Halo ${name} 👋
Saya adalah asisten pribadimu untuk membuat *VLESS* dan *TROJAN*.
Silahkan pilih menu di bawah ini:

• *username* : ${username}
• *ID*       : \`${chatId}\`

📅 *${hari}, ${tgl}*
⏰ *${jam} WIB*`;

  const buttons = [
    [{ text: "👤 Menu User",  callback_data: "menu_user_main" }],
    [{ text: "🛡️ Menu Admin", callback_data: "menu_admin_main" }],
    [{ text: "🎁 SUPPORT 🎁", callback_data: "menu_support" }]
  ];
  await sendMessage(chatId, text, { inline_keyboard: buttons });
}

// ===== CEK KUOTA (.cek) memakai API_DOMPUL =====
async function handleCekQuotaCommand(chatId, messageText) {
  const args = messageText.split(' ').slice(1);
  if (args.length < 1) { await sendMessage(chatId, '❌ Format: .cek <nomor1,nomor2,nomor3>'); return; }
  const numbers = args.join(' ').split(',').map(n => n.trim()).filter(validateNumber);
  if (numbers.length === 0) {
    await sendMessage(chatId, '❌ Tidak ada nomor valid.\nHanya mendukung nomor diawali 628 atau 08 dengan panjang 10–13 digit.');
    return;
  }
  const statusMessage = await sendMessage(chatId, `🔍 Mengecek kuota untuk ${numbers.length} nomor...`);
  const messageId = statusMessage.result?.message_id;

  let resultsText = `☁︎ *❛HASIL CEK KUOTA❟*☁︎\n\n\`\`\`\n`;
  for (const number of numbers) {
    try {
      resultsText += await processNumber(number);
      resultsText += `\n========================\n\n`;
    } catch (e) {
      resultsText += `🚫 Gagal cek nomor ${number}: ${e.message}\n\n`;
    }
  }
  resultsText += "```";
  await editMessage(chatId, messageId, resultsText);
}

function validateNumber(number) {
  let n = number.replace(/[^0-9]/g, '');
  if (n.startsWith("08")) n = "62" + n.slice(1);
  return (n.startsWith("628") && n.length >= 11 && n.length <= 13);
}
function formatDateID(dateInput) {
  const d = new Date(dateInput); if (isNaN(d)) return 'Tanggal tidak valid';
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}
async function processNumber(number) {
  const r = await fetch(CONFIG.API_DOMPUL + encodeURIComponent(number), {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  });
  let out = '';
  if (r.ok) {
    const data = await r.json();
    if (data.data && data.data.data_sp) {
      const sp = data.data.data_sp;
      out += `[ SCAN RESULTS ]\n====================\n`;
      out += `[+] Number      : ${number}\n`;
      out += `[+] Masa Aktif  : ${sp.active_period?.value || '-'}\n`;
      out += `[+] Card Type   : ${sp.prefix?.value || '-'}\n`;
      out += `[+] 4G Status   : ${sp.status_4g?.value || '-'}\n`;
      out += `[+] Dukcapil    : ${sp.dukcapil?.value || '-'}\n`;
      out += `[+] Card Age    : ${sp.active_card?.value || '-'}\n`;
      out += `[+] Tenggang    : ${sp.grace_period?.value || '-'}\n\n`;
      if (sp.quotas?.success && Array.isArray(sp.quotas.value)) {
        out += `[ ACTIVE PACKAGES ]\n====================\n`;
        for (const group of sp.quotas.value) for (const pkg of group) if (pkg.packages) {
          out += `[+] Package : ${pkg.packages.name}\n[+] Valid   : ${formatDateID(pkg.packages.expDate)}\n`;
          if (pkg.benefits?.length) for (const b of pkg.benefits) {
            out += `  - ${b.bname}\n    Type: ${b.type}\n    Total: ${b.quota}\n    Remain: ${b.remaining}\n\n`;
          } else out += `[!] NO BENEFITS FOR THIS PACKAGE\n\n`;
        }
      } else out += `[!] NO ACTIVE PACKAGES FOUND\n`;
    } else out += `🚫 Tidak ada data untuk nomor ${number}\n`;
  } else out += `🚫 API gagal merespons untuk nomor ${number}\n`;
  return out;
}

// ===== BROADCAST TEKS (admin) =====
async function handleBroadcastCommand(chatId, messageText, env) {
  if (!isAdmin(chatId)) { await sendMessage(chatId, 'Kamu bukan admin. Akses ditolak.'); return; }
  const args = messageText.split(' ').slice(1);
  if (!args.length) { await sendMessage(chatId, '❌ Format: /broadcast <pesan>'); return; }
  const message = args.join(' ');

  const userList = await env.DATA_DB.list();
  const users = userList.keys.map(k => k.name).filter(n => /^\d+$/.test(n));
  if (!users.length) { await sendMessage(chatId, '❌ Tidak ada user yang terdaftar.'); return; }

  const statusMessage = await sendMessage(chatId, `⏳ Memulai broadcast ke ${users.length} user...\n☢ Progress: 0/${users.length}`);
  const state = { message, offset: 0, batchSize: 3, totalUsers: users.length, startTime: new Date().toISOString(), messageId: statusMessage.result?.message_id, successCount: 0, failCount: 0 };
  await env.DATA_DB.put(`broadcast:${chatId}`, JSON.stringify(state));
  await sendBatch(chatId, env);
}
async function sendBatch(chatId, env) {
  const raw = await env.DATA_DB.get(`broadcast:${chatId}`); if (!raw) return;
  const state = JSON.parse(raw);
  const userList = await env.DATA_DB.list();
  const users = userList.keys.map(k => k.name).filter(n => /^\d+$/.test(n));

  const end = Math.min(state.offset + state.batchSize, users.length);
  const batch = users.slice(state.offset, end);
  let ok = 0, fail = 0, fails = [];

  for (const uid of batch) {
    try {
      const res = await sendMessage(uid, `📢 *PESAN DARI ADMIN*\n\n${state.message}\n\n_Pesan pribadi dari admin_`);
      if (res?.ok) ok++; else { fail++; fails.push(`User ${uid}: ${res?.description || 'unknown'}`); await env.DATA_DB.delete(uid); }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { fail++; fails.push(`User ${uid}: ${e.message}`); }
  }

  state.successCount += ok; state.failCount += fail; state.offset = end;
  await env.DATA_DB.put(`broadcast:${chatId}`, JSON.stringify(state));

  let report = `㊝*Laporan Broadcast*㊝\n\n⚲ Berhasil: ${state.successCount}\n⚲ Gagal: ${state.failCount}\n⚲ Progress: ${end}/${state.totalUsers} user\n❛ Dimulai: ${new Date(state.startTime).toLocaleString('id-ID')}\n\n`;
  if (fail && fails.length) {
    for (let i = 0; i < Math.min(3, fails.length); i++) report += `• ${fails[i]}\n`;
    if (fails.length > 3) report += `• ... dan ${fails.length - 3} lainnya\n`;
  }

  const kb = [];
  if (end < users.length) { report += `\nKlik "Lanjut" untuk mengirim batch berikutnya.`; kb.push([{ text: "🔜", callback_data: "broadcast_next" }]); }
  else { report += `\n🕊 *Broadcast selesai!*`; await env.DATA_DB.delete(`broadcast:${chatId}`); }
  kb.push([{ text: "⛔ Berhenti", callback_data: "broadcast_stop" }]);
  await editMessage(chatId, state.messageId, report, { inline_keyboard: kb });
}

// ===== BROADCAST GAMBAR (admin) =====
async function handleBroadcastImageCommand(chatId, message, env) {
  if (!isAdmin(chatId)) { await sendMessage(chatId, 'Kamu bukan admin. Akses ditolak.'); return; }
  const photos = message.photo || []; if (!photos.length) { await sendMessage(chatId, '❌ Tidak ada foto terdeteksi.'); return; }
  const file_id = photos[photos.length - 1].file_id;
  const caption = (message.caption || '').split(' ').slice(1).join(' ') || 'Broadcast gambar dari admin';

  const userList = await env.DATA_DB.list();
  const users = userList.keys.map(k => k.name).filter(n => /^\d+$/.test(n));
  if (!users.length) { await sendMessage(chatId, '❌ Tidak ada user yang terdaftar.'); return; }

  const statusMessage = await sendMessage(chatId, `⏳ Memulai broadcast gambar ke ${users.length} user...`);
  const state = { file_id, caption, offset: 0, batchSize: 3, totalUsers: users.length, startTime: new Date().toISOString(), messageId: statusMessage.result?.message_id, successCount: 0, failCount: 0 };
  await env.DATA_DB.put(`broadcastimg:${chatId}`, JSON.stringify(state));
  await sendImageBatch(chatId, env);
}
async function handleBroadcastImageFromArgs(chatId, messageText, env) {
  if (!isAdmin(chatId)) { await sendMessage(chatId, 'Kamu bukan admin. Akses ditolak.'); return; }
  const args = messageText.split(' ').slice(1);
  if (!args.length) { await sendMessage(chatId, '❌ Format: /broadcastimage <file_id> [caption]'); return; }
  const file_id = args[0]; const caption = args.slice(1).join(' ') || 'Broadcast gambar dari admin';

  const userList = await env.DATA_DB.list();
  const users = userList.keys.map(k => k.name).filter(n => /^\d+$/.test(n));
  if (!users.length) { await sendMessage(chatId, '❌ Tidak ada user yang terdaftar.'); return; }

  const statusMessage = await sendMessage(chatId, `⏳ Memulai broadcast gambar ke ${users.length} user...`);
  const state = { file_id, caption, offset: 0, batchSize: 3, totalUsers: users.length, startTime: new Date().toISOString(), messageId: statusMessage.result?.message_id, successCount: 0, failCount: 0 };
  await env.DATA_DB.put(`broadcastimg:${chatId}`, JSON.stringify(state));
  await sendImageBatch(chatId, env);
}
async function sendImageBatch(chatId, env) {
  const raw = await env.DATA_DB.get(`broadcastimg:${chatId}`); if (!raw) return;
  const state = JSON.parse(raw);
  const userList = await env.DATA_DB.list();
  const users = userList.keys.map(k => k.name).filter(n => /^\d+$/.test(n));

  const end = Math.min(state.offset + state.batchSize, users.length);
  const batch = users.slice(state.offset, end);
  let ok = 0, fail = 0, fails = [];

  for (const uid of batch) {
    try {
      const res = await sendPhoto(uid, state.file_id, state.caption);
      if (res?.ok) ok++; else { fail++; fails.push(`User ${uid}: ${res?.description || 'unknown'}`); await env.DATA_DB.delete(uid); }
      await new Promise(r => setTimeout(r, 200));
    } catch (e) { fail++; fails.push(`User ${uid}: ${e.message}`); }
  }

  state.successCount += ok; state.failCount += fail; state.offset = end;
  await env.DATA_DB.put(`broadcastimg:${chatId}`, JSON.stringify(state));

  let report = `㊝*Laporan Broadcast Gambar*㊝\n\n⚲ Berhasil: ${state.successCount}\n⚲ Gagal: ${state.failCount}\n⚲ Progress: ${end}/${state.totalUsers} user\n❛ Dimulai: ${new Date(state.startTime).toLocaleString('id-ID')}\n\n`;
  if (fail && fails.length) {
    for (let i = 0; i < Math.min(3, fails.length); i++) report += `• ${fails[i]}\n`;
    if (fails.length > 3) report += `• ... dan ${fails.length - 3} lainnya\n`;
  }
  const kb = [];
  if (end < users.length) { report += `\nKlik "Lanjut" untuk mengirim batch berikutnya.`; kb.push([{ text: "🔜", callback_data: "broadcastimg_next" }]); }
  else { report += `\n🕊 *Broadcast gambar selesai!*`; await env.DATA_DB.delete(`broadcastimg:${chatId}`); }
  kb.push([{ text: "⛔ Berhenti", callback_data: "broadcastimg_stop" }]);
  await editMessage(chatId, state.messageId, report, { inline_keyboard: kb });
}

// ===== LISTUSER (admin-only, nama + ID, 10/hal) =====
async function handleListUserCommand(chatId, env) {
  if (!isAdmin(chatId)) { await sendMessage(chatId, 'Akses ditolak. Perintah ini untuk admin.'); return; }
  const processing = await sendMessage(chatId, '⏳ Mengambil daftar pengguna...');
  const keys = await env.DATA_DB.list();
  if (!keys.keys.length) { await editMessage(chatId, processing.result.message_id, '🍥 *Daftar Pengguna*\n\n❌ Belum ada pengguna.'); return; }
  const total = keys.keys.length, per = 10, pages = Math.ceil(total / per);
  await showUserListPage(chatId, processing.result.message_id, keys.keys, 1, pages, env);
}
async function showUserListPage(chatId, messageId, userKeys, page, totalPages, env) {
  const per = 10, start = (page - 1) * per, end = Math.min(start + per, userKeys.length);
  let txt = `🀌*Daftar Pengguna*🀌\n\n⚲ Total: ${userKeys.length} pengguna\n⚲ Halaman: ${page}/${totalPages}\n\n`;
  for (let i = start; i < end; i++) {
    const k = userKeys[i]; let display = `User ID: ${k.name}`;
    try { const raw = await env.DATA_DB.get(k.name); if (raw) { const u = JSON.parse(raw); const nm = `${u.first_name || ''} ${u.last_name || ''}`.trim() || '(Tanpa Nama)'; display = `${nm} (ID: ${k.name})`; } } catch {}
    txt += `${i + 1}. 👤 ${display}\n`;
  }
  const nav = [];
  if (totalPages > 1) {
    if (page > 1) nav.push({ text: "🔚", callback_data: `userpage_${page - 1}` });
    if (page < totalPages) nav.push({ text: "🔜", callback_data: `userpage_${page + 1}` });
  }
  nav.push({ text: "🔄 Refresh", callback_data: "user_refresh" });
  await editMessage(chatId, messageId, txt, { inline_keyboard: [nav] });
}

// ===== BANDWIDTH CF =====
function tenDaysAgo() { const d = new Date(); d.setDate(d.getDate() - 10); return d.toISOString().split('T')[0]; }
async function handleBandwidthCommand(chatId, env) {
  try {
    const processing = await sendMessage(chatId, '⏳ Mengambil data bandwidth...');
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
      await editMessage(chatId, processing.result.message_id, "⚠️ CLOUDFLARE_API_TOKEN atau CLOUDFLARE_ZONE_ID belum dikonfigurasi."); return;
    }
    const q1 = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($zone: String!, $since: Date!) {
          viewer { zones(filter: { zoneTag: $zone }) {
            httpRequests1dGroups(limit: 30, orderBy: [date_DESC], filter:{date_geq:$since}) {
              sum { bytes requests } dimensions { date }
            } } } }`,
        variables: { zone: env.CLOUDFLARE_ZONE_ID, since: tenDaysAgo() }
      })
    });
    const r1 = await q1.json();
    const groups = r1?.data?.viewer?.zones?.[0]?.httpRequests1dGroups;
    if (groups?.length) {
      let tb=0,tr=0, txt="*☁︎❛Data Pemakaian User 10 hari terakhir❟☁︎:*\n\n";
      for (const d of groups.reverse()) { const b=d.sum.bytes||0, r=d.sum.requests||0; tb+=b; tr+=r; txt+=`࿋ *${d.dimensions.date}*\n☣︎ ${(b/(1024**3)).toFixed(2)} GB\n☣︎ ${r.toLocaleString()} requests\n\n`; }
      txt += `*࿋ TOTAL KESELURUHAN ࿋:*\n☣︎ ${(tb/(1024**3)).toFixed(2)} GB\n☣︎ ${tr.toLocaleString()} requests`;
      await editMessage(chatId, processing.result.message_id, txt); return;
    }
    // fallback 24h
    const q2 = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($zone: String!) {
          viewer { zones(filter: { zoneTag: $zone }) {
            httpRequests1hGroups(limit: 24, orderBy:[datetime_DESC]) {
              sum { bytes requests } dimensions { datetime }
            } } } }`,
        variables: { zone: env.CLOUDFLARE_ZONE_ID }
      })
    });
    const r2 = await q2.json();
    const hours = r2?.data?.viewer?.zones?.[0]?.httpRequests1hGroups;
    if (hours?.length) {
      let tb=0,tr=0, txt="*☁︎❛Data Pemakaian User 24 Jam Terakhir❟☁︎:*\n\n";
      for (const h of hours.reverse()) { const b=h.sum.bytes||0, r=h.sum.requests||0; tb+=b; tr+=r; txt+=`࿋ ${h.dimensions.datetime.split('T')[1].substring(0,5)}\n☣︎ ${(b/(1024**2)).toFixed(2)} MB\n☣︎ ${r.toLocaleString()} requests\n\n`; }
      txt += `*⁠♡TOTAL KESELURUHAN⁠♡:*\n☣︎ ${(tb/(1024**3)).toFixed(2)} GB\n☣︎ ${tr.toLocaleString()} requests\n\n_⚠️ Data terbatas karena akun Free Plan_`;
      await editMessage(chatId, processing.result.message_id, txt); return;
    }
    await editMessage(chatId, processing.result.message_id, "⚠️ Data pemakaian tidak tersedia.");
  } catch (e) {
    console.error('Bandwidth error:', e);
    await sendMessage(chatId, `⚠️ Gagal mengambil data pemakaian.\n\n_Error:_ ${e.message}`);
  }
}

// ===== Random Proxy (ambil dari GitHub) =====
async function fetchProxyList() {
  try {
    const r = await fetch('https://raw.githubusercontent.com/AFRcloud/ProxyList/refs/heads/main/ProxyList.txt');
    if (!r.ok) throw new Error('Gagal mengambil data proxy');
    return parseProxyList(await r.text());
  } catch (e) { console.error('fetchProxyList:', e); return []; }
}
function parseProxyList(text) {
  const lines = text.split('\n').filter(x => x.trim());
  return lines.map(line => {
    const [ip, port, cc = '', isp = ''] = line.split(',');
    return { ip: (ip||'').trim(), port: (port||'').trim(), countryCode: (cc||'').trim(), isp: (isp||'').trim(), flag: getCountryFlag((cc||'').trim()) };
  });
}
function getCountryFlag(cc) {
  const m = {'ID':'🇮🇩','US':'🇺🇸','JP':'🇯🇵','CN':'🇨🇳','KR':'🇰🇷','VN':'🇻🇳','SG':'🇸🇬','TH':'🇹🇭','IN':'🇮🇳','GB':'🇬🇧'};
  return m[cc] || '🏴';
}
async function handleGetRandomProxy(chatId) {
  try {
    const list = await fetchProxyList();
    if (!list.length) { await sendMessage(chatId, '❌ Gagal mengambil data proxy dari GitHub'); return; }
    const byCountry = {};
    list.forEach(p => { if (!byCountry[p.countryCode]) byCountry[p.countryCode] = []; byCountry[p.countryCode].push(p); });

    // Grid 3 kolom
    const entries = Object.entries(byCountry).map(([cc, arr]) => ({
      text: `${getCountryFlag(cc)} ${cc} (${arr.length})`,
      data: `country_${cc}`
    }));
    const rows = [];
    for (let i = 0; i < entries.length; i += 3) {
      const slice = entries.slice(i, i + 3).map(e => ({ text: e.text, callback_data: e.data }));
      rows.push(slice);
    }

    await sendMessage(chatId, '❛❟❛ Pilih negara proxy:', { inline_keyboard: rows });
  } catch (e) { console.error('getrandomproxy:', e); await sendMessage(chatId, '❌ Error mengambil data proxy'); }
}
async function handleCountrySelection(chatId, messageId, cc, page = 0) {
  try {
    const list = await fetchProxyList();
    const arr = list.filter(p => p.countryCode === cc);
    if (!arr.length) { await editMessage(chatId, messageId, '❌ Tidak ada proxy untuk negara ini'); return; }
    const per = 5, pages = Math.ceil(arr.length / per), start = page * per, pageArr = arr.slice(start, start + per);
    const proxyButtons = pageArr.map((p, i) => [{ text: `${p.flag} ${p.ip}:${p.port}`, callback_data: `proxy_${cc}_${start + i}` }]);
    const nav = [];
    if (pages > 1) {
      if (page > 0) nav.push({ text: "🔚", callback_data: `countrypage_${cc}_${page - 1}` });
      if (page < pages - 1) nav.push({ text: "🔜", callback_data: `countrypage_${cc}_${page + 1}` });
      if (nav.length) proxyButtons.push(nav);
      proxyButtons.push([{ text: `📄 Halaman ${page + 1}/${pages}`, callback_data: 'page_info' }]);
    }
    proxyButtons.push([{ text: "🔚", callback_data: "back_to_countries" }]);
    await editMessage(chatId, messageId, `❟❛❟ Proxy ${getCountryFlag(cc)} ${cc} (${arr.length} proxy):\nHalaman ${page + 1} dari ${pages}`, { inline_keyboard: proxyButtons });
  } catch (e) { console.error('countrySelection:', e); await editMessage(chatId, messageId, '❌ Error memuat proxy'); }
}
async function handleProxySelection(chatId, messageId, cc, index) {
  try {
    const list = await fetchProxyList();
    const arr = list.filter(p => p.countryCode === cc);
    const sel = arr[index]; if (!sel) { await editMessage(chatId, messageId, '❌ Proxy tidak ditemukan'); return; }
    await editMessage(chatId, messageId, `⏳ Memeriksa ${sel.ip}:${sel.port}...`);
    const r = await fetch(`${CONFIG.API_URL}${sel.ip}:${sel.port}`, { headers: { 'User-Agent': 'Cloudflare-Workers-Bot' } });
    if (!r.ok) { await editMessage(chatId, messageId, '❌ Proxy tidak aktif'); return; }
    const data = await r.json();
    memoryKV.set(chatId, { data, expires: Date.now() + 3600000, messageId });
    await showIPResults(chatId, messageId, data);
  } catch (e) { console.error('proxySelection:', e); await editMessage(chatId, messageId, '❌ Error memeriksa proxy'); }
}

// ===== IP Check =====
function isValidIP(ip) { return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){2}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip); }
async function processMessage(message, chatId) {
  if (memoryKV.has(chatId)) memoryKV.delete(chatId);
  const [ipRaw, portRaw] = message.split(':'); const ip = ipRaw.trim(); const port = portRaw ? portRaw.trim() : '443';
  if (!isValidIP(ip)) { await sendMessage(chatId, '❌ Format IP tidak valid. coba ulang kembali ke /menu'); return; }
  if (isNaN(port) || port < 1 || port > 65535) { await sendMessage(chatId, '❌ Port harus antara 1-65535'); return; }

  const processing = await sendMessage(chatId, '⏳ Memeriksa IP...'); const messageId = processing.result.message_id;
  const total = 10, spin = ['❛','☉','❟'];
  for (let s=1; s<=total; s++) {
    const bar = '▱'.repeat(s) + '▰'.repeat(total - s); const pct = Math.floor((s/total)*100); await editMessage(chatId, messageId, `${spin[s%spin.length]} [${bar}] ${pct}%`); await new Promise(r => setTimeout(r, 400));
  }
  try {
    const r = await fetch(`${CONFIG.API_URL}${ip}:${port}`, { headers: { 'User-Agent': 'Cloudflare-Workers-Bot' } });
    if (!r.ok) { await editMessage(chatId, messageId, '❌ Gagal mengambil data. Pastikan IP valid.'); return; }
    const data = await r.json(); memoryKV.set(chatId, { data, expires: Date.now() + 3600000, messageId }); await showIPResults(chatId, messageId, data);
  } catch { await editMessage(chatId, messageId, '❌ Error: Gagal memproses request'); }
}
async function showIPResults(chatId, messageId, data) {
  let m = `*ཐི🤖ཋྀ Hasil Check IP:*\n\`\`\`\n`;
  m += `┌───────────────────────\n`;
  m += `│ IP     : ${data.proxyHost || 'N/A'}\n`;
  m += `│ Port   : ${data.proxyPort || 'N/A'}\n`;
  m += `│ ISP    : ${data.isp || 'N/A'} ${data.flag || ''}\n`;
  m += `│ Status : ${data.proxyStatus || 'N/A'}\n`;
  m += `│ Delay  : ${data.delay || 'N/A'}\n`;
  m += `└───────────────────────\n\`\`\`\n`;

  if (data.proxyStatus && data.proxyStatus.includes('✅ ACTIVE ✅')) {
    m += `𓆩❤︎𓆪 *PILIH PROTOCOL:*`;
    await editMessage(chatId, messageId, m, {
      inline_keyboard: [
        [{ text: "🤖❛VLESS❟🤖",  callback_data: "vless_main" },
         { text: "🤖❛TROJAN❟🤖", callback_data: "trojan_main" }],
        [{ text: "🔚 Kembali", callback_data: "back_to_main" }]
      ]
    });
  } else {
    await editMessage(chatId, messageId, m + '\n❌ Proxy tidak aktif, tidak bisa membuat config');
  }
}

// ===== Callback Query (tombol) =====
async function handleCallbackQuery(cb, env) {
  const { id, data, message } = cb;
  const chatId = message.chat.id; const messageId = message.message_id;
  try {
    await answerCallbackQuery(id);

    // ——— Menu User/Admin ———
    if (data === 'menu_user_main') {
      const kb = [
        [{ text: "🌐 getrandomproxy", callback_data: "u_getrandomproxy" }],
        [{ text: "🔎 cek kuota",      callback_data: "u_cek_quota" }],
        [{ text: "🏓 ping",           callback_data: "u_ping" }],
        [{ text: "📊 bandwidth",      callback_data: "u_bandwidth" }],
        [{ text: "👤 user detail",    callback_data: "u_userdetail" }],
      ];
      await sendMessage(chatId, "Pilih *Menu User* ⬇️", { inline_keyboard: kb }); return;
    }
    if (data === 'menu_admin_main') {
      if (!isAdmin(chatId)) { await answerCallbackQuery(id, 'Hanya admin'); return; }
      const kb = [
        [{ text: "📢 broadcast teks",   callback_data: "a_broadcast_text" }],
        [{ text: "🖼 broadcast gambar", callback_data: "a_broadcast_image" }],
        [{ text: "📋 list user",        callback_data: "a_listuser" }],
        [{ text: "📊 bandwidth",        callback_data: "a_bandwidth" }],
        [{ text: "🏓 ping",             callback_data: "a_ping" }],
      ];
      await sendMessage(chatId, "Pilih *Menu Admin* ⬇️", { inline_keyboard: kb }); return;
    }
    if (data === 'menu_support') {
      const cap = " Buah Cengkudu Buah Tomat Oh ya ammpun di lihat 🤣🤣";
      await sendPhoto(chatId, CONFIG.SUPPORT_IMAGE_URL, cap);
      return;
    }

    // ——— Aksi Menu USER ———
    if (data === 'u_getrandomproxy') { await handleGetRandomProxy(chatId); return; }
    if (data === 'u_ping')           { await pingCrot(chatId); return; }
    if (data === 'u_bandwidth')      { await handleBandwidthCommand(chatId, env); return; }
    if (data === 'u_userdetail')     { await sendMessage(chatId, "Kirim `/userdetail` (tanpa arg = detail kamu sendiri)."); return; }
    if (data === 'u_cek_quota') {
      memoryKV.set(chatId, { mode: 'await_quota', until: Date.now() + 10*60*1000 });
      await sendMessage(chatId, "Silahkan masukan *nomor XL/AXIS/SMART* anda dengan awalan *628/0878*.\nContoh: `62812xxxxxxx` atau beberapa nomor dipisah koma.");
      return;
    }

    // ——— Aksi Menu ADMIN ———
    if (data === 'a_broadcast_text')  { if (!isAdmin(chatId)) { await answerCallbackQuery(id,'Hanya admin'); return; } await sendMessage(chatId, "Kirim perintah: `/broadcast <pesan>`"); return; }
    if (data === 'a_broadcast_image') { if (!isAdmin(chatId)) { await answerCallbackQuery(id,'Hanya admin'); return; } await sendMessage(chatId, "Reply foto dengan caption `/broadcastimage` atau `/broadcastimage <file_id> <caption>`"); return; }
    if (data === 'a_listuser')        { if (!isAdmin(chatId)) { await answerCallbackQuery(id,'Hanya admin'); return; } await handleListUserCommand(chatId, env); return; }
    if (data === 'a_bandwidth')       { if (!isAdmin(chatId)) { await answerCallbackQuery(id,'Hanya admin'); return; } await handleBandwidthCommand(chatId, env); return; }
    if (data === 'a_ping')            { if (!isAdmin(chatId)) { await answerCallbackQuery(id,'Hanya admin'); return; } await pingCrot(chatId); return; }

    // ——— Navigasi proxy negara ———
    if (data.startsWith('country_')) { const cc = data.split('_')[1]; await handleCountrySelection(chatId, messageId, cc); return; }
    if (data.startsWith('countrypage_')) { const [_, cc, p] = data.split('_'); await handleCountrySelection(chatId, messageId, cc, parseInt(p)); return; }
    if (data.startsWith('proxy_')) { const [_, cc, i] = data.split('_'); await handleProxySelection(chatId, messageId, cc, parseInt(i)); return; }
    if (data === 'back_to_countries') { await handleGetRandomProxy(chatId); await deleteMessage(chatId, messageId); return; }
    if (data === 'page_info') { await answerCallbackQuery(id, 'Gunakan tombol navigasi untuk melihat halaman lainnya'); return; }

    // ——— List user nav ———
    if (data.startsWith('userpage_')) {
      const page = parseInt(data.split('_')[1]);
      const userKeys = await env.DATA_DB.list(); const pages = Math.ceil(userKeys.keys.length / 10);
      await showUserListPage(chatId, messageId, userKeys.keys, page, pages, env); return;
    }
    if (data === 'user_refresh') {
      const userKeys = await env.DATA_DB.list(); const pages = Math.ceil(userKeys.keys.length / 10);
      await showUserListPage(chatId, messageId, userKeys.keys, 1, pages, env); await answerCallbackQuery(id, '✅ Daftar diperbarui'); return;
    }

    // ——— Broadcast controls ———
    if (data === 'broadcast_next')     { await sendBatch(chatId, env); return; }
    if (data === 'broadcast_stop')     { await env.DATA_DB.delete(`broadcast:${chatId}`); await editMessage(chatId, messageId, '⛔ Broadcast dihentikan.'); return; }
    if (data === 'broadcastimg_next')  { await sendImageBatch(chatId, env); return; }
    if (data === 'broadcastimg_stop')  { await env.DATA_DB.delete(`broadcastimg:${chatId}`); await editMessage(chatId, messageId, '⛔ Broadcast gambar dihentikan.'); return; }

    // ——— Konfigurasi VLESS/TROJAN/Wildcard ———
    const stored = memoryKV.get(chatId);
    if (!stored) { await editMessage(chatId, messageId, '❌ Session expired. Kirim IP lagi.'); return; }
    switch (data) {
      case 'vless_main': await showVlessConfig(chatId, messageId, stored.data); break;
      case 'trojan_main': await showTrojanConfig(chatId, messageId, stored.data); break;
      case 'back_to_main': await showIPResults(chatId, messageId, stored.data); break;
      default:
        if (data.startsWith('vless_') || data.startsWith('trojan_')) await showWildcardConfig(chatId, messageId, stored.data, data);
    }
  } catch (e) {
    console.error('Callback error:', e);
    await answerCallbackQuery(cb.id, '❌ Error processing request');
  }
}

// ===== VLESS / TROJAN / Wildcard =====
async function showVlessConfig(chatId, messageId, data) {
  const name = encodeURIComponent(`${data.isp} ${data.flag}`);
  const t =
`*❛=========VLESS=========
CF VLESS CONFIGURATION
=========VLESS=========❟*

*TLS:* 
\`vless://${CONFIG.PASSUID}@${CONFIG.SERVERVLESS}:443?type=ws&security=tls&path=%2Fvless%3D${data.proxyHost}%3D${data.proxyPort}&host=${CONFIG.SERVERVLESS}&sni=${CONFIG.SERVERVLESS}#${name}\`

*NTLS:* 
\`vless://${CONFIG.PASSUID}@${CONFIG.SERVERVLESS}:80?type=ws&security=none&path=%2Fvless%3D${data.proxyHost}%3D${data.proxyPort}&host=${CONFIG.SERVERVLESS}#${name}\`

*CLASH VLESS*
\`\`\`
proxies:
- name: ${data.isp} ${data.flag}
  server: ${CONFIG.SERVERVLESS}
  port: 443
  type: vless
  uuid: ${CONFIG.PASSUID}
  cipher: auto
  tls: true
  skip-cert-verify: true
  network: ws
  servername: ${CONFIG.SERVERVLESS}
  ws-opts:
    path: /vless=${data.proxyHost}=${data.proxyPort}
    headers:
      Host: ${CONFIG.SERVERVLESS}
  udp: true
\`\`\``;
  await editMessage(chatId, messageId, t, { inline_keyboard: [[{ text: "❛❟❛ Pilih Wildcard", callback_data: "vless_wildcard" }],[{ text: "🔚 Kembali", callback_data: "back_to_main" }]] });
}
async function showTrojanConfig(chatId, messageId, data) {
  const name = encodeURIComponent(`${data.isp} ${data.flag}`);
  const t =
`*❛=========TROJAN=========
CF TROJAN CONFIGURATION
=========TROJAN=========❟*

*TLS:* 
\`trojan://${CONFIG.PASSUID}@${CONFIG.SERVERTROJAN}:443?type=ws&security=tls&path=%2Ftrojan%3D${data.proxyHost}%3D${data.proxyPort}&host=${CONFIG.SERVERTROJAN}&sni=${CONFIG.SERVERTROJAN}#${name}\`

*NTLS:* 
\`trojan://${CONFIG.PASSUID}@${CONFIG.SERVERTROJAN}:80?type=ws&security=none&path=%2Ftrojan%3D${data.proxyHost}%3D${data.proxyPort}&host=${CONFIG.SERVERTROJAN}#${name}\`

*CLASH TROJAN*
\`\`\`
proxies:
- name: ${data.isp} ${data.flag}
  server: ${CONFIG.SERVERTROJAN}
  port: 443
  type: trojan
  password: ${CONFIG.PASSUID}
  skip-cert-verify: true
  network: ws
  sni: ${CONFIG.SERVERTROJAN}
  ws-opts:
    path: /trojan=${data.proxyHost}=${data.proxyPort}
    headers:
      Host: ${CONFIG.SERVERTROJAN}
  udp: true
\`\`\``;
  await editMessage(chatId, messageId, t, { inline_keyboard: [[{ text: "❛❟❛ Pilih Wildcard", callback_data: "trojan_wildcard" }],[{ text: "🔚 Kembali", callback_data: "back_to_main" }]] });
}
async function showWildcardConfig(chatId, messageId, data, cbData) {
  const [proto, key] = cbData.split('_');
  const WC = { ava:"ava.game.naver.com", quiz_int:"quiz.int.vidio.com", zoom:"support.zoom.us", tiktok:"api24-normal-alisg.tiktokv.com" };
  const host = WC[key] || WC.ava; const domain = `${host}.${CONFIG.SERVERWILDCARD}`;
  const name = encodeURIComponent(`${data.isp} ${data.flag}`);

  let t='';
  if (proto === 'vless') {
    t = `*❛=========VLESS WC=========
CF VLESS WILCARD CONFIGURATION
=========VLESS WC=========❟ (${host})*\n
*TLS:*
\`vless://${CONFIG.PASSUID}@${domain}:443?type=ws&security=tls&path=%2Fvless%3D${data.proxyHost}%3D${data.proxyPort}&host=${domain}&sni=${domain}#${name}\`
        
*NTLS:*
\`vless://${CONFIG.PASSUID}@${domain}:80?type=ws&security=none&path=%2Fvless%3D${data.proxyHost}%3D${data.proxyPort}&host=${domain}#${name}\`

*CLASH VLESS*
\`\`\`
proxies:
- name: ${data.isp} ${data.flag}
  server: ${domain}
  port: 443
  type: vless
  uuid: ${CONFIG.PASSUID}
  cipher: auto
  tls: true
  skip-cert-verify: true
  network: ws
  servername: ${domain}
  ws-opts:
    path: /vless=${data.proxyHost}=${data.proxyPort}
    headers:
      Host: ${domain}
  udp: true
\`\`\``;
  } else if (proto === 'trojan') {
    t = `*❛=========TROJAN WC=========
CF TROJAN WILCARDCONFIGURATION
=========TROJAN WC=========❟ (${host})*\n
*TLS:*
\`trojan://${CONFIG.PASSUID}@${domain}:443?type=ws&security=tls&path=%2Ftrojan%3D${data.proxyHost}%3D${data.proxyPort}&host=${domain}&sni=${domain}#${name}\`

*NTLS:*
\`trojan://${CONFIG.PASSUID}@${domain}:80?type=ws&security=none&path=%2Ftrojan%3D${data.proxyHost}%3D${data.proxyPort}&host=${domain}#${name}\`

*CLASH TROJAN*
\`\`\`
proxies:
- name: ${data.isp} ${data.flag}
  server: ${domain}
  port: 443
  type: trojan
  password: ${CONFIG.PASSUID}
  skip-cert-verify: true
  network: ws
  sni: ${domain}
  ws-opts:
    path: /trojan=${data.proxyHost}=${data.proxyPort}
    headers:
      Host: ${domain}
  udp: true
\`\`\``;
  }
  const hostButtons = Object.entries(WC).map(([k, v]) => [{ text: v, callback_data: `${proto}_${k}` }]);
  hostButtons.push([{ text: "🔚 Kembali", callback_data: `${proto}_main` }]);
  await editMessage(chatId, messageId, t, { inline_keyboard: hostButtons });
}

// ===== Ping =====
async function pingCrot(chatId) {
  const s = Date.now(); const r = await sendMessage(chatId, 'ping...'); const e = Date.now();
  await editMessage(chatId, r.result?.message_id, `❛Pong❟ ${e - s} ms`);
}

// ===== Telegram API helpers =====
async function sendMessage(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text: text + (CONFIG.WATERMARK || ''), parse_mode: 'Markdown', reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : undefined };
  try { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); const res = await r.json(); if (!res.ok) console.error('sendMessage fail:', res.description); return res; } catch (e) { console.error('sendMessage err:', e); return { ok:false, description:e.message }; }
}
async function editMessage(chatId, messageId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/editMessageText`;
  const payload = { chat_id: chatId, message_id: messageId, text: text + (CONFIG.WATERMARK || ''), parse_mode: 'Markdown', reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : undefined };
  try { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); return await r.json(); } catch (e) { console.error('editMessage err:', e); return { ok:false, description:e.message }; }
}
async function sendPhoto(chatId, file_or_url, caption='') {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const payload = { chat_id: chatId, photo: file_or_url, caption: caption + (CONFIG.WATERMARK || ''), parse_mode: 'Markdown' };
  try { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); return await r.json(); } catch (e) { console.error('sendPhoto err:', e); return { ok:false, description:e.message }; }
}
async function answerCallbackQuery(callbackQueryId, text='') {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  try { await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: !!text })}); } catch (e) { console.error('answerCallbackQuery err:', e); }
}
async function deleteMessage(chatId, messageId) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/deleteMessage`;
  try { await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, message_id: messageId })}); } catch (e) { console.error('deleteMessage err:', e); }
}

// ===== Export Worker =====
export default { async fetch(request, env) {
  CONFIG.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || CONFIG.TELEGRAM_BOT_TOKEN;
  CONFIG.SERVERVLESS = env.SERVERVLESS || CONFIG.SERVERVLESS;
  CONFIG.SERVERTROJAN = env.SERVERTROJAN || CONFIG.SERVERTROJAN;
  CONFIG.SERVERWILDCARD = env.SERVERWILDCARD || CONFIG.SERVERWILDCARD;
  CONFIG.PASSUID = env.PASSUID || CONFIG.PASSUID;
  CONFIG.API_URL = env.API_URL || CONFIG.API_URL;
  CONFIG.API_DOMPUL = env.API_DOMPUL || CONFIG.API_DOMPUL;
  CONFIG.SUPPORT_IMAGE_URL = env.SUPPORT_IMAGE_URL || CONFIG.SUPPORT_IMAGE_URL;
  CONFIG.WATERMARK = env.WATERMARK || CONFIG.WATERMARK;
  CONFIG.ADMIN_IDS = parseAdminIds(env.ADMIN_ID || '');
  return handleRequest(request, env);
}};
