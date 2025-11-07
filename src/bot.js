// src/bot.js
import { buildSettings } from './settings.js';
import { handleCommand } from './features.js';
import { sendMessage } from './telegram.js';

export default {
  async fetch(request, env, ctx){
    const s = buildSettings(env);
    const url = new URL(request.url);
    if(url.pathname !== '/webhook') return new Response('Not Found', {status:404});
    if(request.method !== 'POST') return new Response('Method Not Allowed', {status:405});

    const body = await request.json();

    // Callback → (opsional) tetap seperti sebelumnya

    if(body.message){
      const msg = body.message;
      // panggil handler features dengan ctx
      const handled = await handleCommand(s, env, ctx, msg);
      if(!handled){
        // fallback
        await sendMessage(s, env, String(msg.chat.id), 'Bot aktif! Silakan kirim /menu lagi untuk fitur lengkap.');
      }
      return new Response('OK',{status:200});
    }

    return new Response('OK',{status:200});
  }
}
