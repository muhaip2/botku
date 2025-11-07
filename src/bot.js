// src/bot.js
import { buildSettings, formatNowTZ } from './settings.js';
import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_MAIN, K_USER, K_ADMIN } from './keyboards.js'; // K_MAIN dsb ada di repo kamu
import { getCountryCountsCached, refreshCountryCounts, countryActiveIPs } from './pool.js';
import { addSubscriber, statsTrack, ensureTotalUsers } from './kv.js';

// tambahan imports untuk fitur proxy
import { K_countryList, K_proxyList, K_proxyActions } from './keyboards.js';
import { listCountries, getProxiesForCountry, fetchIpInfo, formatIpInfo } from './proxy.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // only accept POST to /webhook
    if (url.pathname !== '/webhook') return new Response('Not Found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const settings = buildSettings(env);
    const body = await request.json().catch(() => ({}));

    // handle callback_query first (inline keyboard)
    if (body.callback_query) {
      const cb = body.callback_query;
      const chatId = String(cb.message?.chat?.id || '');
      const data = cb.data || '';

      // ----- custom pagination & select handlers -----
      try {
        if (data === 'CLOSE') {
          await answerCallback(settings, cb.id, 'Okay');
          await sendMessage(settings, env, chatId, '✅ Ditutup.');
          return new Response('OK', { status: 200 });
        }

        // country pagination
        if (data.startsWith('COUNTRY_PAGE|')) {
          const page = Number(data.split('|')[1] || 0);
          const countries = listCountries();
          await answerCallback(settings, cb.id, 'OK');
          await sendMessage(settings, env, chatId, `🌍 Pilih negara (halaman ${page + 1})`, K_countryList(countries, page));
          return new Response('OK', { status: 200 });
        }

        // select country: show proxy list for that country (page 0)
        if (data.startsWith('SELECT_COUNTRY|')) {
          const code = data.split('|')[1];
          const proxies = getProxiesForCountry(code);
          await answerCallback(settings, cb.id, `Negara ${code}`);
          if (!proxies || proxies.length === 0) {
            await sendMessage(settings, env, chatId, `❌ Tidak ada proxy untuk negara ${code}.`);
            return new Response('OK', { status: 200 });
          }
          await sendMessage(settings, env, chatId, `📦 Proxy untuk ${code}:`, K_proxyList(code, proxies, 0));
          return new Response('OK', { status: 200 });
        }

        // proxy pages
        if (data.startsWith('PROXY_PAGE|')) {
          const parts = data.split('|');
          const country = parts[1];
          const page = Number(parts[2] || 0);
          const proxies = getProxiesForCountry(country);
          await answerCallback(settings, cb.id, 'OK');
          await sendMessage(settings, env, chatId, `📦 Proxy ${country} (halaman ${page + 1})`, K_proxyList(country, proxies, page));
          return new Response('OK', { status: 200 });
        }

        // select a proxy (ip:port) -> fetch info -> show actions
        if (data.startsWith('SELECT_PROXY|')) {
          const parts = data.split('|');
          const country = parts[1];
          const idx = Number(parts[2] || 0);
          const proxies = getProxiesForCountry(country);
          const entry = proxies[idx];
          if (!entry) {
            await answerCallback(settings, cb.id, 'Proxy tidak ditemukan');
            return new Response('OK', { status: 200 });
          }
          await answerCallback(settings, cb.id, 'Memproses info IP...');
          const [ip, port] = String(entry).split(':');
          const info = await fetchIpInfo(settings, ip).catch(() => null);
          const text = formatIpInfo(ip, port, info || {});
          await sendMessage(settings, env, chatId, text, K_proxyActions(entry));
          return new Response('OK', { status: 200 });
        }

        // make vless / trojan from selected ip
        if (data.startsWith('MAKE_VLESS|') || data.startsWith('MAKE_TROJAN|')) {
          const [cmd, ipport] = data.split('|');
          const [ip, port] = ipport.split(':');
          if (cmd === 'MAKE_VLESS') {
            // contoh vless minimal — sesuaikan parameter sesuai kebutuhan
            const uuid = settings.PASSUUID || '00000000-0000-0000-0000-000000000000';
            const domain = settings.SERVER_WILDCARD || settings.SERVER_VLESS || ip;
            const vless = `vless://${uuid}@${ip}:${port}?encryption=none&security=tls&type=tcp#${ip}`;
            await answerCallback(settings, cb.id, 'VLESS dibuat');
            await sendMessage(settings, env, chatId, `🔧 VLESS config:\n\n${vless}`);
          } else {
            const pass = settings.PASSUUID || 'password';
            const trojan = `trojan://${pass}@${ip}:${port}#${ip}`;
            await answerCallback(settings, cb.id, 'TROJAN dibuat');
            await sendMessage(settings, env, chatId, `🔧 TROJAN config:\n\n${trojan}`);
          }
          return new Response('OK', { status: 200 });
        }
      } catch (err) {
        // jika ada error di callback handler, balas OK ke Telegram agar tidak retry terus
        try { await answerCallback(settings, cb.id, 'Error'); } catch (e) {}
        return new Response('OK', { status: 200 });
      }

      // jika bukan custom callback -> jika ingin biarkan modul awal menangani
      // Ubah menjadi message biasa agar router di bawah memproses (sama seperti sebelumnya)
      if (data.startsWith('OPEN_CMD|')) {
        const cmd = data.slice(9);
        body.message = {
          chat: { id: chatId, type: 'private' },
          text: cmd,
          from: cb.from
        };
        delete body.callback_query;
      } else {
        // default: jawab callback dan stop
        await answerCallback(settings, cb.id);
        return new Response('OK', { status: 200 });
      }
    }

    // ========= Message handling (body.message) =========
    if (body.message) {
      const msg       = body.message;
      const chatId    = String(msg.chat.id);
      const chatType  = String(msg.chat.type || 'private');
      const firstName = (msg.from?.first_name) || '';
      const username  = msg.from?.username ? ('@' + msg.from.username) : '';
      const text      = (msg.text || '').trim();
      const isAdmin   = settings.ADMIN_IDS.map(String).includes(chatId);

      // record user & stats
      await addSubscriber(env, chatId).catch(() => {});
      await statsTrack(env, chatId, username, chatType, 'message').catch(() => {});
      await ensureTotalUsers(env).catch(() => {});

      // /start & /menu
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

      // /menu_user
      if (text === '/menu_user') {
        await sendMessage(settings, env, chatId, '*Menu User*', K_USER());
        return new Response('OK', { status: 200 });
      }

      // /menu_admin
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

      // ---- /proxyip : mulai menu negara
      if (text === '/proxyip') {
        const countries = listCountries();
        if (!countries || countries.length === 0) {
          await sendMessage(settings, env, chatId, '❌ Tidak ada daftar negara.');
          return new Response('OK', { status: 200 });
        }
        await sendMessage(settings, env, chatId, '🌍 Pilih negara (gunakan tombol):', K_countryList(countries, 0));
        return new Response('OK', { status: 200 });
      }

      // ---- contoh fitur lain: speedtest / show pool count
      if (text === '/show_pool_count' || text === '/showpool') {
        const cnt = await countryActiveIPs(settings, env).catch(() => null);
        await sendMessage(settings, env, chatId, `📦 Pool count: ${JSON.stringify(cnt)}`);
        return new Response('OK', { status: 200 });
      }

      // fallback: diam (jangan spam)
      return new Response('OK', { status: 200 });
    }

    // nothing to do
    return new Response('OK', { status: 200 });
  }
};
