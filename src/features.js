// src/features.js
import { sendMessage, editMessage, answerCallback } from './telegram.js';
import { K_countryList } from './keyboards.js';
import { getCountryCountsCached, refreshCountryCounts, countryActiveIPs, randomProxyList } from './pool.js';

export async function handleCommand(s, env, ctx, msg){
  const chatId = String(msg.chat.id);
  const text = (msg.text||'').trim();

  /* ... handler lain tetap ... */

  // === /proxyip: cache-first & background refresh ===
  if(text.startsWith('/proxyip')){
    // 1) kirim placeholder dulu (instan)
    const sent = await sendMessage(s, env, chatId, '⏳ Menyiapkan daftar negara…');

    // 2) tampilkan cache kalau ada (instan)
    const cached = await getCountryCountsCached(env);
    if (cached && cached.length){
      await editMessage(
        s, env, chatId, sent.result?.message_id || sent.message_id,
        '*🌍 Pilih negara (cached)*',
        K_countryList(cached, 0, s.COUNTRY_PAGE_SIZE)
      );
      // 3) refresh di background, lalu update pesan yang sama
      ctx.waitUntil(
        (async ()=>{
          try{
            const fresh = await refreshCountryCounts(s, env);
            await editMessage(
              s, env, chatId, sent.result?.message_id || sent.message_id,
              '*🌍 Pilih negara (update terbaru)*',
              K_countryList(fresh, 0, s.COUNTRY_PAGE_SIZE)
            );
          }catch(_){}
        })()
      );
      return true;
    }

    // 4) jika cache kosong → lakukan scan sekarang (pertama kali saja)
    try{
      const fresh = await refreshCountryCounts(s, env);
      await editMessage(
        s, env, chatId, sent.result?.message_id || sent.message_id,
        '*🌍 Pilih negara*',
        K_countryList(fresh, 0, s.COUNTRY_PAGE_SIZE)
      );
    }catch{
      await editMessage(
        s, env, chatId, sent.result?.message_id || sent.message_id,
        '❌ Gagal memuat daftar negara. Coba lagi.'
      );
    }
    return true;
  }

  return false; // tidak ditangani di sini
}
