// src/bot.js

import { buildSettings, formatNowTZ } from './settings.js';
import { sendMessage, answerCallback } from './telegram.js';
import { K_MAIN, K_USER, K_ADMIN, K_USERS_PAGER } from './keyboards.js';
import { addSubscriber, statsTrack, ensureTotalUsers,
         upsertUserIndex, getUsersPage, getUsersTotal } from './kv.js';
import { runBg } from './utils.js';

// ——— Teks bantuan (Markdown)
function helpUserText() {
  return (
`*📜 Perintah User*

• */menu* — buka menu utama.
• */menu_user* — tampilkan tombol fitur user.
• */myid* — lihat detail akun kamu.
• */random_proxy* — ambil 1 proxy acak.
• */speedtest* — uji kecepatan (ringan).
• */bandwidth* — info bandwidth/latensi ringkas.
• */pool_count* — jumlah total proxy di pool.

Kamu bisa menekan tombol di *Menu User* atau kirim command langsung.`
  );
}

function helpAdminText() {
  return (
`*📜 Perintah Admin*

• */menu_admin* — tampilkan tombol fitur admin.
• */users* — lihat daftar user (10 per halaman).
• */broadcast* — kirim siaran (teks/foto, galeri).
• */stats7* — statistik 7 hari terakhir.
• */pool_admin* — kelola pool proxy.

Hanya ID di *ADMIN_IDS* yang bisa memakai ini.`
  );
}

function fmtUsername(u) {
  if (!u) return '-';
  return u.startsWith('@') ? u : '@' + u;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const settings = buildSettings(env);
    const body = await request.json().catch(() => ({}));

    // ===== Callback Query -> translate ke message agar routing seragam
    if (body.callback_query) {
      const cb   = body.callback_query;
      const data = cb.data || '';
      runBg(ctx, answerCallback(settings, cb.id, 'OK'));

      if (data.startsWith('OPEN_CMD|')) {
        const chatId = String(cb.message?.chat?.id || '');
        body.message = {
          chat: { id: chatId, type: 'private' },
          text: data.slice(9), // misal: "/users 2"
          from: cb.from
        };
        delete body.callback_query;
      } else {
        return new Response('OK', { status: 200 });
      }
    }

    // ===== Message
    if (body.message) {
      const msg       = body.message;
      const chatId    = String(msg.chat.id);
      const chatType  = String(msg.chat.type || 'private');
      const firstName = (msg.from?.first_name) || '';
      const username  = msg.from?.username || '';
      const text      = (msg.text || '').trim();
      const isAdmin   = settings.ADMIN_IDS.map(String).includes(chatId);

      // catat statistik di background
      runBg(ctx, addSubscriber(env, chatId));
      runBg(ctx, statsTrack(env, chatId, username ? '@'+username : '', chatType, 'message'));
      runBg(ctx, ensureTotalUsers(env));
      // upsert index user untuk fitur /users
      runBg(ctx, upsertUserIndex(env, { id: chatId, name: firstName, username }));

      // ---- /start | /menu
      if (/^\/(start|menu)\b/i.test(text)) {
        const hello =
`Halo *${firstName}*, aku adalah asisten pribadimu.

👤 Nama: *${firstName}* ${username ? `(@${username})` : ''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${formatNowTZ(settings.TIMEZONE)}_`;
        runBg(ctx, sendMessage(settings, env, chatId, hello, K_MAIN));
        return new Response('OK', { status: 200 });
      }

      // ---- User Menus
      if (text === '/menu_user') {
        runBg(ctx, sendMessage(settings, env, chatId, '*Menu User*', K_USER()));
        return new Response('OK', { status: 200 });
      }
      if (text === '/help_user') {
        runBg(ctx, sendMessage(settings, env, chatId, helpUserText()));
        return new Response('OK', { status: 200 });
      }

      // ---- /myid (untuk semua user)
      if (/^\/myid\b/i.test(text)) {
        const info =
`*Detail Akun Kamu*
• *Nama*      : ${firstName || '-'}
• *ID*        : \`${chatId}\`
• *Username*  : ${fmtUsername(username)}
• *Timezone*  : ${settings.TIMEZONE || 'UTC'}`;
        runBg(ctx, sendMessage(settings, env, chatId, info));
        return new Response('OK', { status: 200 });
      }

      // ---- Admin Menus
      if (text === '/menu_admin') {
        if (!isAdmin) {
          runBg(ctx, sendMessage(settings, env, chatId, '🙏 Maaf, fitur ini hanya untuk admin.'));
          return new Response('OK', { status: 200 });
        }
        runBg(ctx, sendMessage(
          settings, env, chatId,
          '*Menu Admin*\n• List Users, Broadcast, Stats7, Kelola Pool Proxy.',
          K_ADMIN()
        ));
        return new Response('OK', { status: 200 });
      }
      if (text === '/help_admin') {
        if (!isAdmin) {
          runBg(ctx, sendMessage(settings, env, chatId, '🙏 Maaf, fitur ini hanya untuk admin.'));
          return new Response('OK', { status: 200 });
        }
        runBg(ctx, sendMessage(settings, env, chatId, helpAdminText()));
        return new Response('OK', { status: 200 });
      }

      // ---- /users [page] (ADMIN)
      if (/^\/users(\s+\d+)?\b/i.test(text)) {
        if (!isAdmin) {
          runBg(ctx, sendMessage(settings, env, chatId, '🙏 Maaf, fitur ini hanya untuk admin.'));
          return new Response('OK', { status: 200 });
        }
        const parts = text.split(/\s+/).filter(Boolean);
        const page = parts[1] ? parseInt(parts[1], 10) : 1;

        const PAGE_SIZE = 10;
        const { page: p, total, totalPages, users } = await getUsersPage(env, page, PAGE_SIZE);

        let out =
`*👥 Daftar Pengguna* (hal. ${p}/${totalPages})
*Jumlah user*: ${total}

`;
        if (!users.length) {
          out += '_Belum ada data pengguna._';
        } else {
          // tampilkan 10 per halaman
          users.forEach((u, idx) => {
            out += `${(p - 1) * PAGE_SIZE + idx + 1}. *${u.name || '-'}*\n   ID: \`${u.id}\`\n   Username: ${fmtUsername(u.username)}\n`;
          });
        }

        runBg(ctx, sendMessage(settings, env, chatId, out, K_USERS_PAGER(p, totalPages)));
        return new Response('OK', { status: 200 });
      }

      // ==== Command lain (placeholder tetap)
      if (text === '/random_proxy') {
        runBg(ctx, sendMessage(settings, env, chatId, '🎲 Mencari proxy acak…'));
        return new Response('OK', { status: 200 });
      }
      if (text === '/speedtest') {
        runBg(ctx, sendMessage(settings, env, chatId, '🚀 Menjalankan speedtest ringan…'));
        return new Response('OK', { status: 200 });
      }
      if (text === '/bandwidth') {
        runBg(ctx, sendMessage(settings, env, chatId, '📶 Mengukur bandwidth…'));
        return new Response('OK', { status: 200 });
      }
      if (text === '/pool_count') {
        runBg(ctx, sendMessage(settings, env, chatId, '📦 Menghitung pool…'));
        return new Response('OK', { status: 200 });
      }
      if (text === '/broadcast' || text === '/stats7' || text === '/pool_admin') {
        runBg(ctx, sendMessage(settings, env, chatId, '✅ Perintah diterima. Memproses…'));
        return new Response('OK', { status: 200 });
      }

      // Fallback: OK (diam) agar webhook tetap cepat
      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  }
};
