// src/telegram.js
import { fetchWithTimeout } from './utils.js';

// Helper internal untuk POST ke Telegram
async function tgPost(settings, method, payload) {
  const url = `${settings.TELEGRAM_API_URL}${method}`;
  const timeout = Number(settings.META_TIMEOUT_MS || 1500);
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }, timeout).catch(() => null);

  if (!res) return null;
  // Jangan lempar error kalau bukan 200—cukup kembalikan null agar tidak menghambat
  try { return await res.json(); } catch { return null; }
}

export async function sendMessage(settings, env, chatId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };
  if (keyboard) payload.reply_markup = keyboard;
  return tgPost(settings, 'sendMessage', payload);
}

export async function editMessage(settings, env, chatId, messageId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };
  if (keyboard) payload.reply_markup = keyboard;
  return tgPost(settings, 'editMessageText', payload);
}

export async function answerCallback(settings, callbackId, text = 'OK', showAlert = false) {
  const payload = { callback_query_id: callbackId, text, show_alert: !!showAlert };
  return tgPost(settings, 'answerCallbackQuery', payload);
}
