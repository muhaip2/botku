// src/bot.js

function buildSettings(env) {
  const bool = v => ['1','true','yes','on'].includes(String(v||'').toLowerCase());
  const list = (v) => String(v||'').split(',').map(s=>s.trim()).filter(Boolean);
  return {
    API: env.TELEGRAM_API_URL || '',               // ex: https://api.telegram.org/bot<token>/
    ADMIN_IDS: list(env.ADMIN_IDS),                // ex: 123,456
    TZ: env.TIMEZONE || 'Asia/Jakarta',
  };
}

function nowTZ(tz) {
  try {
    return new Date().toLocaleString('id-ID', {
      timeZone: tz, weekday:'long', year:'numeric', month:'long',
      day:'numeric', hour:'2-digit', minute:'2-digit'
    });
  } catch { return new Date().toISOString(); }
}

async function tg(method, body, API) {
  return fetch(API + method, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()).catch(()=> ({}));
}

async function sendMessage(API, chat_id, text, reply_markup=null) {
  const body = { chat_id, text, parse_mode:'Markdown', disable_web_page_preview:true };
  if (reply_markup) body.reply_markup = reply_markup;
  return tg('sendMessage', body, API);
}

const K_MAIN = {
  inline_keyboard: [
    [{ text:'📱 Menu User',  callback_data:'OPEN|/menu_user' }],
    [{ text:'⚙️ Menu Admin', callback_data:'OPEN|/menu_admin' }],
  ]
};
const K_USER = {
  inline_keyboard: [
    [{ text:'🎲 Random Proxy', callback_data:'OPEN|/random_proxy' }],
    [{ text:'🌍 Proxy per Negara', callback_data:'OPEN|/proxyip' }],
    [{ text:'⬅️ Kembali', callback_data:'OPEN|/menu' }],
  ]
};
const K_ADMIN = {
  inline_keyboard: [
    [{ text:'📝 Broadcast', callback_data:'OPEN|/broadcast' }],
    [{ text:'📊 Stats', callback_data:'OPEN|/stats' }],
    [{ text:'⬅️ Kembali ke Menu User', callback_data:'OPEN|/menu_user' }],
  ]
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const S = buildSettings(env);

    // health check (GET)
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    // webhook endpoint
    if (url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let update = {};
    try { update = await request.json(); } catch {}

    // Handle "OPEN|/cmd" dari tombol inline => jadikan seolah user mengirim /cmd
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      if (data.startsWith('OPEN|')) {
        update.message = {
          chat: cb.message.chat,
          from: cb.from,
          text: data.slice(5)
        };
      }
      // selalu ack agar Telegram tidak menunggu
      await tg('answerCallbackQuery', { callback_query_id: cb.id }, S.API);
    }

    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const firstName = msg.from?.first_name || '';
      const username = msg.from?.username ? ('@' + msg.from.username) : '';
      const isAdmin = S.ADMIN_IDS.includes(chatId);
      const text = (msg.text || '').trim();

      // /start /menu
      if (text === '/start' || text === '/menu') {
        const hello =
`Halo *${firstName}*, aku adalah asisten pribadimu.
Tolong rawat aku ya seperti kamu merawat diri sendiri 😘

👤 Nama: *${firstName}* ${username?`(${username})`:''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${nowTZ(S.TZ)}_`;
        await sendMessage(S.API, chatId, hello, K_MAIN);
        return new Response('OK', { status: 200 });
      }

      // menu user
      if (text === '/menu_user') {
        await sendMessage(S.API, chatId, '*Menu User*', K_USER);
        return new Response('OK', { status: 200 });
      }

      // menu admin
      if (text === '/menu_admin') {
        if (!isAdmin) {
          await sendMessage(S.API, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
          return new Response('OK', { status: 200 });
        }
        await sendMessage(S.API, chatId, '*Menu Admin*', K_ADMIN);
        return new Response('OK', { status: 200 });
      }

      // placeholder fitur lain (belum diisi)
      if (text === '/random_proxy' || text === '/proxyip' || text === '/broadcast' || text === '/stats') {
        await sendMessage(S.API, chatId, '✅ Bot aktif. Fitur lengkap akan ditambahkan bertahap.');
        return new Response('OK', { status: 200 });
      }

      // fallback: diam-diam OK
      return new Response('OK', { status: 200 });
    }

    // selalu 200 agar Telegram tidak retry
    return new Response('OK', { status: 200 });
  }
};
