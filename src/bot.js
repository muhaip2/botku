// src/bot.js

import { buildSettings, formatNowTZ } from './settings.js';
import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_MAIN, K_USER, K_ADMIN } from './keyboards.js';
import { getCountryCountsCached, refreshCountryCounts, countryActiveIPs } from './pool.js';
import { addSubscriber, statsTrack, ensureTotalUsers } from './kv.js';

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

      // Pola: OPEN_CMD|/perintah
      if (data.startsWith('OPEN_CMD|')) {
        const cmd = data.slice(9);
        await answerCallback(settings, cb.id, 'OK');
        // Ubah menjadi message biasa agar router di bawah memproses
        body.message = {
          chat: { id: chatId, type: 'private' },
          text: cmd,
          from: cb.from
        };
        delete body.callback_query;
      } else {
        await answerCallback(settings, cb.id);
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

      // catat user & statistik
      await addSubscriber(env, chatId).catch(() => {});
      await statsTrack(env, chatId, username, chatType, 'message').catch(() => {});
      await ensureTotalUsers(env).catch(() => {});

      // ---- /start & /menu (selalu ditangani duluan)
      if (/^\/(start|menu)\b/i.test(text)) {
        const hello =
`Halo *${firstName}*, aku adalah asisten pribadimu.
Tolong rawat aku ya seperti kamu merawat diri sendiri 😘

👤 Nama: *${firstName}* ${username ? `(${username})` : ''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${formatNowTZ(settings.TIMEZONE)}_`;
        await sendMessage(settings, env, chatId, hello, K_MAIN);
        return new Response('OK', { status: 200 });
      }

      // ---- Menu User
      if (text === '/menu_user') {
        await sendMessage(settings, env, chatId, '*Menu User*', K_USER());
        return new Response('OK', { status: 200 });
      }

      // ---- Menu Admin
      if (text === '/menu_admin') {
        if (!isAdmin) {
          await sendMessage(settings, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
          return new Response('OK', { status: 200 });
        }
        await sendMessage(
          settings,
          env,
          chatId,
          '*Menu Admin*\n• Broadcast teks/foto (galeri) dengan preview.\n• Stats & tren 7 hari.\n• Kelola pool proxy.',
          K_ADMIN()
        );
        return new Response('OK', { status: 200 });
      }

      // ---- Perintah lain akan ditangani oleh modul features (jika ada)
      // Contoh: /proxyip memakai cache negara
      if (text === '/proxyip') {
        await sendMessage(settings, env, chatId, '⏳ Menyiapkan daftar negara…', null);
        // pastikan cache siap
        await refreshCountryCounts(settings, env).catch(() => {});
        const list = await getCountryCountsCached(settings, env);
        if (!list || !list.length) {
          await sendMessage(settings, env, chatId, '❌ Gagal menyiapkan daftar negara.');
        } else {
          // keyboard list negara dihandle di modul keyboards (dipanggil oleh features biasanya).
          // Kalau kamu sudah punya helper K_countryList, panggil di modul terkait.
          await sendMessage(settings, env, chatId, '🌍 Daftar negara siap. Silakan pilih via tombol sebelumnya.');
        }
        return new Response('OK', { status: 200 });
      }

      // Fallback: diam (jangan spam)
      return new Response('OK', { status: 200 });
    }

    // Tidak ada message/callback
    return new Response('OK', { status: 200 });
  }
};
