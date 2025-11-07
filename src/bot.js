// src/bot.js
import { buildSettings, formatNowTZ } from './settings.js';
import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_MAIN, K_USER, K_ADMIN } from './keyboards.js';
import { getCountryCountsCached, refreshCountryCounts } from './pool.js';
import { addSubscriber, statsTrack, ensureTotalUsers } from './kv.js';
import { runBg } from './utils.js';

export default {
  async fetch(request, env, ctx) {
    // Hanya terima POST ke /webhook
    const url = new URL(request.url);
    if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const settings = buildSettings(env);
    const body = await request.json().catch(() => ({}));

    // ========= Callback Query (inline keyboard)
    if (body.callback_query) {
      const cb = body.callback_query;
      const chatId = String(cb.message?.chat?.id || '');
      const data = cb.data || '';

      // Jawab callback secepatnya
      runBg(ctx, answerCallback(settings, cb.id, 'OK'));

      // Pola: OPEN_CMD|/perintah  -> diubah jadi message supaya router pesan yang proses
      if (data.startsWith('OPEN_CMD|')) {
        const cmd = data.slice(9);
        body.message = {
          chat: { id: chatId, type: 'private' },
          text: cmd,
          from: cb.from
        };
        delete body.callback_query;
      } else {
        // tidak ada tindakan lanjut
        return new Response('OK', { status: 200 });
      }
    }

    // ========= Message
    if (body.message) {
      const msg       = body.message;
      const chatId    = String(msg.chat.id);
      const chatType  = String(msg.chat.type || 'private');
      const firstName = (msg.from?.first_name) || '';
      const username  = msg.from?.username ? ('@' + msg.from.username) : '';
      const text      = (msg.text || '').trim();
      const isAdmin   = settings.ADMIN_IDS.map(String).includes(chatId);

      // catat user & statistik -> background agar webhook cepat selesai
      runBg(ctx, addSubscriber(env, chatId));
      runBg(ctx, statsTrack(env, chatId, username, chatType, 'message'));
      runBg(ctx, ensureTotalUsers(env));

      // ---- /start & /menu
      if (/^\/(start|menu)\b/i.test(text)) {
        const hello =
`Halo *${firstName}*, aku adalah asisten pribadimu.
Tolong rawat aku ya seperti kamu merawat diri sendiri 😘

👤 Nama: *${firstName}* ${username ? `(${username})` : ''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${formatNowTZ(settings.TIMEZONE)}_`;
        runBg(ctx, sendMessage(settings, env, chatId, hello, K_MAIN));
        return new Response('OK', { status: 200 });
      }

      // ---- Menu User
      if (text === '/menu_user') {
        runBg(ctx, sendMessage(settings, env, chatId, '*Menu User*', K_USER()));
        return new Response('OK', { status: 200 });
      }

      // ---- Menu Admin
      if (text === '/menu_admin') {
        if (!isAdmin) {
          runBg(ctx, sendMessage(settings, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.'));
          return new Response('OK', { status: 200 });
        }
        runBg(ctx, sendMessage(
          settings,
          env,
          chatId,
          '*Menu Admin*\n• Broadcast teks/foto (galeri) dengan preview.\n• Stats & tren 7 hari.\n• Kelola pool proxy.',
          K_ADMIN()
        ));
        return new Response('OK', { status: 200 });
      }

      // ---- /proxyip: siapkan daftar negara di background
      if (text === '/proxyip') {
        runBg(ctx, (async () => {
          // refresh cache negara tanpa menghambat webhook
          await refreshCountryCounts(settings, env).catch(() => {});
          const list = await getCountryCountsCached(settings, env);
          if (!list || !list.length) {
            await sendMessage(settings, env, chatId, '❌ Gagal menyiapkan daftar negara.');
          } else {
            await sendMessage(settings, env, chatId, '🌍 Daftar negara siap. Silakan pilih via tombol "Proxy per Negara" di menu.', null);
          }
        })());
        return new Response('OK', { status: 200 });
      }

      // Fallback: jangan spam—balas OK saja
      return new Response('OK', { status: 200 });
    }

    // Tidak ada message/callback
    return new Response('OK', { status: 200 });
  }
};
