// src/bot.js (kerangka aman)
async function tgSend(api, chat_id, text, markup=null) {
  const body = { chat_id, text, parse_mode: 'Markdown', disable_web_page_preview: true };
  if (markup) body.reply_markup = markup;
  await fetch(api + 'sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === '/health') {
        return new Response('ok', { status: 200 });
      }
      if (url.pathname !== '/webhook') {
        return new Response('Not Found', { status: 404 });
      }
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      // --- handle update ---
      let update = {};
      try { update = await request.json(); } catch (e) { console.error('json', e); }

      // message
      if (update.message) {
        const msg = update.message;
        const chatId = String(msg.chat.id);
        const text = (msg.text || '').trim();

        if (text === '/menu' || text.startsWith('/start')) {
          await tgSend(env.TELEGRAM_API_URL, chatId, '*Bot aktif!* Silakan kirim /menu lagi untuk fitur lengkap.');
        }
      }

      // callback_query (optional)
      if (update.callback_query) {
        // minimal ack agar Telegram tidak menunggu
        await fetch(env.TELEGRAM_API_URL + 'answerCallbackQuery', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ callback_query_id: update.callback_query.id })
        });
      }

      return new Response('OK', { status: 200 });
    } catch (e) {
      console.error('fatal', e);
      // tetap 200 agar Telegram tidak spam retry
      return new Response('OK', { status: 200 });
    }
  }
};
