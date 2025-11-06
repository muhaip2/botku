// _worker.js
import bot from "./src/bot.js"; // pakai default export dari file bot

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthcheck sederhana (cek dari browser)
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Webhook Telegram — WAJIB POST
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      // Teruskan ke handler utama (file src/bot.js)
      return bot.fetch
        ? bot.fetch(request, env, ctx)            // kalau bot-mu export default { fetch() { ... } }
        : bot(request, env, ctx);                 // kalau export default function(request, env) { ... }
    }

    return new Response("Not Found", { status: 404 });
  },
};
