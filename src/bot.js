// src/bot.js
import { buildSettings } from './settings.js';
import { handleCommand } from './features.js';

import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_countryList, K_ipList, K_proto, K_wildcard } from './keyboards.js';
import { getCountryCountsCached, refreshCountryCounts, countryActiveIPs } from './pool.js';
import { fetchMeta, headerFromMeta } from './meta.js';

/* ----------------- small helpers ----------------- */
const ts = () => Date.now();
const ok = (d='OK') => new Response(d, { status: 200 });
const notFound = () => new Response('Not Found', { status: 404 });
const notAllowed = () => new Response('Method Not Allowed', { status: 405 });

function parseJSONSafe(req) {
  return req.json().catch(() => ({}));
}

// build wildcard host from key
function wildcardHostByKey(s, key) {
  const v = s.WILDCARD_MAP?.[key];
  if (!v) return null;
  if (v.includes('.')) return v;
  if (!s.SERVER_WILDCARD) return null;
  return `${v}.${s.SERVER_WILDCARD}`;
}

// simple link builders
function vlessTLS(s, hostSNI, innerHost, innerPort, tag) {
  const u = s.PASSUUID, enc = encodeURIComponent(tag || '');
  return `vless://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Fvless%3D${innerHost}%3D${innerPort}#${enc}`;
}
function vlessNTLS(s, hostSNI, innerHost, innerPort, tag) {
  const u = s.PASSUUID, enc = encodeURIComponent(tag || '');
  return `vless://${u}@${hostSNI}:80?path=%2Fvless%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}
function trojanTLS(s, hostSNI, innerHost, innerPort, tag) {
  const u = s.PASSUUID, enc = encodeURIComponent(tag || '');
  return `trojan://${u}@${hostSNI}:443?encryption=none&security=tls&sni=${hostSNI}&fp=randomized&type=ws&host=${hostSNI}&path=%2Ftrojan%3D${innerHost}%3D${innerPort}#${enc}`;
}
function trojanNTLS(s, hostSNI, innerHost, innerPort, tag) {
  const u = s.PASSUUID, enc = encodeURIComponent(tag || '');
  return `trojan://${u}@${hostSNI}:80?path=%2Ftrojan%3D${innerHost}%3D${innerPort}&security=none&encryption=none&host=${hostSNI}#${enc}`;
}

/* ----------------- main worker ----------------- */
export default {
  async fetch(request, env, ctx) {
    const s = buildSettings(env);
    const url = new URL(request.url);
    if (url.pathname !== '/webhook') return notFound();
    if (request.method !== 'POST') return notAllowed();

    const body = await parseJSONSafe(request);

    /* ===== Callback Query ===== */
    if (body.callback_query) {
      const cb = body.callback_query;
      const chatId = String(cb.message?.chat?.id || '');
      const data = cb.data || '';

      // OPEN_CMD -> treat like text message
      if (data.startsWith('OPEN_CMD|')) {
        const cmd = data.slice(9);
        await answerCallback(s, cb.id, 'OK');
        body.message = {
          chat: { id: chatId, type: 'private' },
          text: cmd,
          from: cb.from
        };
        delete body.callback_query;
        // and continue to message handling below
      }
      // CPAGE -> paginasi negara
      else if (data.startsWith('CPAGE|')) {
        await answerCallback(s, cb.id);
        const page = Number(data.split('|')[1] || 0);
        const cached = await getCountryCountsCached(env) || await refreshCountryCounts(s, env);
        await editMessage(
          s, env, chatId, cb.message.message_id,
          '*🌍 Pilih negara (cached)*',
          K_countryList(cached, page, s.COUNTRY_PAGE_SIZE)
        );
        // refresh di background untuk hasil terbaru
        ctx.waitUntil((async()=>{
          try{
            const fresh = await refreshCountryCounts(s, env);
            await editMessage(s, env, chatId, cb.message.message_id,
              '*🌍 Pilih negara (update terbaru)*',
              K_countryList(fresh, page, s.COUNTRY_PAGE_SIZE)
            );
          }catch(_){}
        })());
        return ok();
      }
      // CSEL -> tampilkan ip list untuk negara
      else if (data.startsWith('CSEL|')) {
        await answerCallback(s, cb.id);
        const [, cc, pageStr] = data.split('|');
        const list = await countryActiveIPs(s, env, cc, s.MAX_ACTIVE_IP_LIST);
        if (!list.length) {
          const cached = await getCountryCountsCached(env) || [];
          await editMessage(
            s, env, chatId, cb.message.message_id,
            `❌ Tidak ada IP aktif untuk ${cc}.`,
            K_countryList(cached, Number(pageStr||0), s.COUNTRY_PAGE_SIZE)
          );
        } else {
          await editMessage(
            s, env, chatId, cb.message.message_id,
            `✅ *IP aktif untuk* ${cc}:\nPilih salah satu:`,
            K_ipList(cc, list)
          );
        }
        return ok();
      }
      // PUSE -> pilih ip:port lalu minta pilih protokol
      else if (data.startsWith('PUSE|')) {
        await answerCallback(s, cb.id);
        const [, cc, enc] = data.split('|');
        const ipport = decodeURIComponent(enc);
        const [ip, port='443'] = ipport.split(':');
        await editMessage(
          s, env, chatId, cb.message.message_id,
          `🔌 *Target:* \`${ip}:${port}\`\nPilih protokol:`,
          K_proto(ip, port)
        );
        return ok();
      }
      // GEN -> pilih VLESS/TROJAN lalu minta wildcard
      else if (data.startsWith('GEN|')) {
        await answerCallback(s, cb.id);
        const [, proto, ip, port] = data.split('|');
        await editMessage(
          s, env, chatId, cb.message.message_id,
          `🎛 *${proto}* untuk \`${ip}:${port}\`\nPilih wildcard:`,
          K_wildcard(s, proto, ip, port)
        );
        return ok();
      }
      // WSEL -> generate config TLS & NTLS
      else if (data.startsWith('WSEL|')) {
        const [, proto, ip, port, key] = data.split('|');
        await answerCallback(s, cb.id, 'Membuat...');
        const host = key === '__NONE__'
          ? (proto === 'VLESS' ? s.SERVER_VLESS : s.SERVER_TROJAN)
          : wildcardHostByKey(s, key);

        if (!host) {
          await sendMessage(s, env, chatId, '❌ Host SNI tidak ditemukan pada ENV.');
          return ok();
        }

        try{
          const m = await fetchMeta(s, ip, port);
          const tag = `${m.isp || ip} ${m.flag || ''}`.trim();
          const innerHost = m.proxyHost || ip;
          const innerPort = m.proxyPort || port;

          const linkTLS  = proto === 'VLESS'
            ? vlessTLS(s, host, innerHost, innerPort, tag)
            : trojanTLS(s, host, innerHost, innerPort, tag);

          const linkNTLS = proto === 'VLESS'
            ? vlessNTLS(s, host, innerHost, innerPort, tag)
            : trojanNTLS(s, host, innerHost, innerPort, tag);

          await editMessage(
            s, env, chatId, cb.message.message_id,
            `✅ *Config ${proto}*\n${headerFromMeta(m)}\n\n` +
            `🔒 *${proto} — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n` +
            `🔓 *${proto} — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\``
          );
        }catch{
          await sendMessage(s, env, chatId, `❌ Gagal ambil data IP ${ip}:${port}`);
        }
        return ok();
      }

      // default: swallow callback
      await answerCallback(s, cb.id);
      return ok();
    }

    /* ===== Normal Message ===== */
    if (body.message) {
      const handled = await handleCommand(buildSettings(env), env, ctx, body.message);
      if (!handled) {
        await sendMessage(
          buildSettings(env),
          env,
          String(body.message.chat.id),
          'Bot aktif! Silakan kirim /menu lagi untuk fitur lengkap.'
        );
      }
      return ok();
    }

    return ok();
  }
};
