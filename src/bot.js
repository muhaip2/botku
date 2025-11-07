// src/bot.js

import { buildSettings, formatNowTZ } from './settings.js';
import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_MAIN, K_USER, K_ADMIN, K_countryList, K_proxyPage,
         COUNTRY_PAGE_SIZE, PROXY_PAGE_SIZE } from './keyboards.js';
import { getCountryCountsCached, refreshCountryCounts, countryActiveIPs } from './pool.js';
import { addSubscriber, statsTrack, ensureTotalUsers } from './kv.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
    if (request.method !== 'POST')    return new Response('Method Not Allowed', { status: 405 });

    // (opsional) validasi secret
    const secret = env.WEBHOOK_SECRET || 'my-bot-tele-2025';
    if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
      return new Response('Unauthorized', { status: 401 });
    }

    const settings = buildSettings(env);
    const body = await request.json().catch(() => ({}));

    // ========= Callback Query
    if (body.callback_query) {
      const cb = body.callback_query;
      const chatId = String(cb.message?.chat?.id || '');
      const data = cb.data || '';

      // navigasi daftar negara
      if (data.startsWith('C_LIST|')) {
        const page = Number(data.split('|')[1] || 1) || 1;
        await refreshCountryCounts(settings, env).catch(()=>{});
        const list = await getCountryCountsCached(settings, env);
        await editMessage(settings, env, chatId, cb.message.message_id,
          '<b>🌍 Pilih Negara</b>',
          K_countryList(list, page, COUNTRY_PAGE_SIZE)
        );
        await answerCallback(settings, cb.id);
        return new Response('OK', { status: 200 });
      }

      // pilih negara => tampilkan halaman IP pertama
      if (data.startsWith('C_PICK|')) {
        const [ , code, pageStr ] = data.split('|');
        const page = Number(pageStr || 1) || 1;
        const ips = await countryActiveIPs(settings, env, code);
        const pageText = renderIps(code, ips, page);
        await editMessage(settings, env, chatId, cb.message.message_id,
          pageText,
          K_proxyPage(code, page, PROXY_PAGE_SIZE)
        );
        await answerCallback(settings, cb.id);
        return new Response('OK', { status: 200 });
      }

      // pindah halaman IP
      if (data.startsWith('P_PAGE|')) {
        const [ , code, pageStr ] = data.split('|');
        const page = Math.max(1, Number(pageStr || 1) || 1);
        const ips = await countryActiveIPs(settings, env, code);
        const pageText = renderIps(code, ips, page);
        await editMessage(settings, env, chatId, cb.message.message_id,
          pageText,
          K_proxyPage(code, page, PROXY_PAGE_SIZE)
        );
        await answerCallback(settings, cb.id);
        return new Response('OK', { status: 200 });
      }

      // biarkan router OPEN_CMD yang lama tetap bekerja
      if (data.startsWith('OPEN_CMD|')) {
        const cmd = data.slice(9);
        await answerCallback(settings, cb.id, 'OK');
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

      await addSubscriber(env, chatId).catch(()=>{});
      await statsTrack(env, chatId, username, chatType, 'message').catch(()=>{});
      await ensureTotalUsers(env).catch(()=>{});

      // /start /menu
      if (/^\/(start|menu)\b/i.test(text)) {
        const hello =
          `Halo <b>${firstName}</b>, aku adalah asisten pribadimu.\n` +
          `Tolong rawat aku ya seperti kamu merawat diri sendiri 😘\n\n` +
          `👤 Nama: <b>${firstName}</b>${username ? ` (${username})` : ''}\n` +
          `🆔 ID: <code>${chatId}</code>\n` +
          `🕒 Waktu: <i>${formatNowTZ(settings.TIMEZONE)}</i>`;
        await sendMessage(settings, env, chatId, hello, K_MAIN());
        return new Response('OK', { status: 200 });
      }

      // Menu User
      if (text === '/menu_user') {
        await sendMessage(settings, env, chatId, '<b>Menu User</b>', K_USER());
        return new Response('OK', { status: 200 });
      }

      // Menu Admin
      if (text === '/menu_admin') {
        if (!isAdmin) {
          await sendMessage(settings, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
          return new Response('OK', { status: 200 });
        }
        await sendMessage(settings, env, chatId,
          '<b>Menu Admin</b>\n• Broadcast\n• Stats/tren\n• Kelola pool',
          K_ADMIN());
        return new Response('OK', { status: 200 });
      }

      // ==== Perintah: buka daftar negara (page 1)
      if (text === '/proxy_by_country' || text === '/proxyip') {
        await sendMessage(settings, env, chatId, '⏳ Menyiapkan daftar negara…');
        await refreshCountryCounts(settings, env).catch(()=>{});
        const list = await getCountryCountsCached(settings, env);
        if (!list || !list.length) {
          await sendMessage(settings, env, chatId, '❌ Gagal menyiapkan daftar negara.');
        } else {
          await sendMessage(settings, env, chatId,
            '<b>🌍 Pilih Negara</b>',
            K_countryList(list, 1, COUNTRY_PAGE_SIZE)
          );
        }
        return new Response('OK', { status: 200 });
      }

      return new Response('OK', { status: 200 });
    }

    return new Response('OK', { status: 200 });
  }
};

// ===== helper untuk menulis teks daftar IP per halaman =====
function renderIps(code, ips = [], page = 1, pageSize = PROXY_PAGE_SIZE) {
  if (!ips.length) return `❌ Tidak ada IP aktif untuk <b>${code}</b>.`;
  const start = (page - 1) * pageSize;
  const show  = ips.slice(start, start + pageSize);
  const lines = show.map((ip, i) => `${start + i + 1}. <code>${ip}</code>`);
  return `<b>🔌 Proxy ${code}</b>\n\n${lines.join('\n')}\n\n` +
         `Gunakan tombol untuk pindah halaman.`;
}
