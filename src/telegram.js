// src/telegram.js
export async function sendMessage(settings, env, chatId, text, replyMarkup = null) {
  const url = settings.TELEGRAM_API_URL + 'sendMessage';
  const body = {
    chat_id: chatId,
    text: String(text),
    parse_mode: 'HTML',              // <- pakai HTML biar aman
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    // log dan lempar error agar terlihat di Cloudflare Logs
    console.log('sendMessage failed:', json);
    throw new Error(json.description || `HTTP ${res.status}`);
  }
  return json.result;
}

export async function editMessage(settings, env, chatId, messageId, text, replyMarkup = null) {
  const url = settings.TELEGRAM_API_URL + 'editMessageText';
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text: String(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    console.log('editMessage failed:', json);
    throw new Error(json.description || `HTTP ${res.status}`);
  }
  return json.result;
}

export async function answerCallback(settings, callbackQueryId, text = 'OK', showAlert = false) {
  const url = settings.TELEGRAM_API_URL + 'answerCallbackQuery';
  const body = { callback_query_id: callbackQueryId, text, show_alert: showAlert };
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
      }
