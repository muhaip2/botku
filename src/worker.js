import { buildSettings, addSubscriber, statsTrack, ensureTotalUsers, trafficLast7, bytesHuman, lastNDaysKeys, formatNowTZ, ccToFlag, cooldown, rateCheck } from './lib/core.js';
import { sendMessage, editMessage, answerCallback } from './lib/telegram.js';
import { getCountryCounts, countryActiveIPs, randomProxyList, headerFromMeta, fetchMeta, vlessTLS, vlessNTLS, trojanTLS, trojanNTLS, wildcardHostByKey } from './lib/proxy.js';
import { K_MAIN, K_USER, K_ADMIN, K_countryList, K_ipList, K_proto, K_wildcard } from './lib/ui.js';

export default {
  async fetch(request, env){
    try{
      const url=new URL(request.url);
      if(url.pathname!=='/webhook') return new Response('Not Found',{status:404});
      if(request.method!=='POST') return new Response('Method Not Allowed',{status:405});
      const s=buildSettings(env);
      const body=await request.json();

      // ===== CALLBACK =====
      if(body.callback_query){
        const cb=body.callback_query;
        const chatId=String(cb.message?.chat?.id||'');
        const data=cb.data||'';

        if(data.startsWith('OPEN_CMD|')){
          const cmd=data.slice(9);
          await answerCallback(s,cb.id,'OK');
          body.message={ chat:{id:chatId,type:'private'}, text:cmd, from:cb.from };
          delete body.callback_query;
        }
        else if(data.startsWith('CPAGE|')){
          const page=Number(data.split('|')[1]||0);
          const list=await getCountryCounts(s,env);
          await answerCallback(s,cb.id);
          await editMessage(s,env,chatId,cb.message.message_id,'*🌍 Pilih negara (cached 10 menit):*', K_countryList(list,page,s.COUNTRY_PAGE_SIZE));
          return new Response('OK',{status:200});
        }
        else if(data.startsWith('CSEL|')){
          const [,cc,pageStr]=data.split('|');
          const list=await countryActiveIPs(s,env,cc,s.MAX_ACTIVE_IP_LIST);
          await answerCallback(s,cb.id);
          if(!list.length){
            await editMessage(s,env,chatId,cb.message.message_id,`❌ Tidak ada IP aktif untuk ${ccToFlag(cc)} *${cc}*.\nCoba negara lain.`, K_countryList(await getCountryCounts(s,env), Number(pageStr||0), s.COUNTRY_PAGE_SIZE));
          } else {
            await editMessage(s,env,chatId,cb.message.message_id,`✅ *IP aktif untuk* ${ccToFlag(cc)} *${cc}*:\nPilih salah satu:`, K_ipList(cc,list));
          }
          return new Response('OK',{status:200});
        }
        else if(data.startsWith('PUSE|')){
          const [,cc,enc]=data.split('|');
          const [ip,port=(/:(\d+)/.exec(enc)?decodeURIComponent(enc).split(':')[1]:'443')] = decodeURIComponent(enc).split(':');
          await answerCallback(s,cb.id);
          await editMessage(s,env,chatId,cb.message.message_id,`🔌 *Target:* \`${ip}:${port}\`\nPilih protokol:`, K_proto(ip,port));
          return new Response('OK',{status:200});
        }
        else if(data.startsWith('GEN|')){
          const [,proto,ip,port]=data.split('|');
          await answerCallback(s,cb.id);
          await editMessage(s,env,chatId,cb.message.message_id,`🎛 *${proto}* untuk \`${ip}:${port}\`\nPilih wildcard:`, K_wildcard(s,proto,ip,port));
          return new Response('OK',{status:200});
        }
        else if(data.startsWith('WSEL|')){
          const [,proto,ip,port,key]=data.split('|');
          await answerCallback(s,cb.id,'Membuat...');
          const host= key==='__NONE__' ? (proto==='VLESS'?s.SERVER_VLESS:s.SERVER_TROJAN) : wildcardHostByKey(s,key);
          if(!host){ await sendMessage(s,env,chatId,'❌ Host SNI tidak ditemukan pada ENV.'); return new Response('OK',{status:200}); }
          try{
            const m=await fetchMeta(s,ip,port);
            const tag=`${m.isp||ip} ${m.flag||''}`.trim();
            const innerHost=m.proxyHost||ip; const innerPort=m.proxyPort||port;
            const linkTLS= proto==='VLESS'?vlessTLS(s,host,innerHost,innerPort,tag):trojanTLS(s,host,innerHost,innerPort,tag);
            const linkNTLS=proto==='VLESS'?vlessNTLS(s,host,innerHost,innerPort,tag):trojanNTLS(s,host,innerHost,innerPort,tag);
            await editMessage(s,env,chatId,cb.message.message_id,`✅ *Config ${proto}*\n${headerFromMeta(m)}\n\n🔒 *${proto} — TLS*\n\`\`\`\n${linkTLS}\n\`\`\`\n🔓 *${proto} — NTLS*\n\`\`\`\n${linkNTLS}\n\`\`\``);
          }catch{ await sendMessage(s,env,chatId,`❌ Gagal ambil data IP ${ip}:${port}`); }
          return new Response('OK',{status:200});
        }

        // default
        await answerCallback(s,cb.id);
        return new Response('OK',{status:200});
      }

      // ===== MESSAGE =====
      if(body.message){
        const msg=body.message;
        const chatId=String(msg.chat.id);
        const chatType=String(msg.chat.type||'private');
        const firstName=(msg.from?.first_name)||'';
        const username=msg.from?.username?('@'+msg.from.username):'';
        const isAdmin=s.ADMIN_IDS.map(String).includes(chatId);

        await addSubscriber(env, chatId);
        await statsTrack(env, chatId, username, chatType, 'message');
        await ensureTotalUsers(env);

        const text=(msg.text||'').trim();

        if(text.startsWith('/start') || text.startsWith('/menu')){
          const hello = `Halo *${firstName}*, aku adalah asisten pribadimu.\nTolong rawat aku ya seperti kamu merawat diri sendiri 😘\n\n👤 Nama: *${firstName}* ${username?`(${username})`:''}\n🆔 ID: \`${chatId}\`\n🕒 Waktu: _${formatNowTZ(s.TIMEZONE)}_`;
          await sendMessage(s, env, chatId, hello, K_MAIN);
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/menu_user')){
          await sendMessage(s, env, chatId, '*Menu User*', K_USER());
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/menu_admin')){
          if(!isAdmin){ await sendMessage(s, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); }
          await sendMessage(s, env, chatId, '*Menu Admin*\n• Broadcast teks/foto (galeri) dengan preview.\n• Stats & tren 7 hari.\n• Kelola pool proxy.', K_ADMIN());
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/random_proxy')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'random_proxy'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          const list = await randomProxyList(s, env, s.RANDOM_PROXY_COUNT);
          if(!list.length){ await sendMessage(s, env, chatId, '❌ Tidak ada proxy valid.'); return new Response('OK',{status:200}); }
          const lines = list.map((x,i)=>{ const m=x.meta||{}; const flag=m.flag||'🏳️'; const isp=m.isp||'-'; const country=m.country||'-'; const ms=(m.delay!=null)?`${m.delay} ms`:'-'; return `${i+1}. ${flag} \`${x.ip}:${x.port}\` — *${isp}* • ${country} • ${ms}`; });
          await sendMessage(s, env, chatId, `🎲 *Random Proxy (Top ${lines.length})*\n`+lines.join('\n'));
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/proxyip')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'proxyip'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          const list=await getCountryCounts(s,env);
          await sendMessage(s, env, chatId, '*🌍 Pilih negara (cached 10 menit):*', K_countryList(list,0,s.COUNTRY_PAGE_SIZE));
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/speedtest')){
          if(!(await rateCheck(env,s,chatId)) || !(await cooldown(env,s,chatId,'speedtest'))){ await sendMessage(s,env,chatId,'⏳ Terlalu cepat, coba lagi.'); return new Response('OK',{status:200}); }
          await sendMessage(s,env,chatId,'🚀 *Memulai speedtest Cloudflare...*');
          const r=(await import('./lib/proxy.js')).speedtestCF ? await (await import('./lib/proxy.js')).speedtestCF(s) : {avg:null,min:null,max:null,down:null};
          const ping = r.avg!=null ? `🏓 Ping: *${r.avg}* ms (min ${r.min}, max ${r.max})` : '🏓 Ping: (gagal)';
          const down = r.down!=null ? `⬇️ Download: *${r.down}* Mbps` : '⬇️ Download: (gagal)';
          await sendMessage(s,env,chatId,`*Hasil Speedtest*\n${ping}\n${down}`);
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/bandwidth')){
          const { trafficLast7, spark, lastNDaysKeys, bytesHuman } = await import('./lib/core.js').then(m=>({trafficLast7: (await import('./lib/core.js')).trafficLast7, spark: (await import('./lib/proxy.js')).spark, lastNDaysKeys: m.lastNDaysKeys, bytesHuman: m.bytesHuman}));
          const vals=await trafficLast7(env); const today=vals[vals.length-1]||0; const total=vals.reduce((a,b)=>a+b,0);
          const chart=(await import('./lib/proxy.js')).spark(vals); const labels=lastNDaysKeys(7).map(k=>`${k.slice(4,6)}/${k.slice(6,8)}`).join('  ');
          await sendMessage(s,env,chatId, `*Penggunaan Bandwidth (payload Telegram)*\n📅 Hari ini: *${bytesHuman(today)}*\n🗓 7 hari: *${bytesHuman(total)}*\n\n\`${chart}\`\n${labels}`);
          return new Response('OK',{status:200});
        }

        if(text.startsWith('/show_pool_count')){ const { mergedPool } = await import('./lib/proxy.js'); const pool=await mergedPool(s,env,{}); await sendMessage(s,env,chatId,`📦 Total entri pool: *${pool.length}*`); return new Response('OK',{status:200}); }
        if(text.startsWith('/reload_pool')){ const { mergedPool } = await import('./lib/proxy.js'); const pool=await mergedPool(s,env,{refresh:true}); await sendMessage(s,env,chatId,`🔄 Pool dimuat ulang: *${pool.length}* entri.`); return new Response('OK',{status:200}); }

        // Broadcast (preview -> confirm/cancel)
        if(text.startsWith('/broadcast_img')){ if(!isAdmin) { await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } const { KV, KV_BCAST } = await import('./lib/core.js'); await KV.set(env,KV_BCAST,{mode:'photo_wait',by:chatId}); await sendMessage(s,env,chatId,'📷 Kirim *foto dari galeri* sekarang (caption opsional).'); return new Response('OK',{status:200}); }
        if(text.startsWith('/broadcast')){ if(!isAdmin){ await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } const payload=text.replace('/broadcast','').trim()||'Contoh broadcast'; const { KV, KV_BCAST } = await import('./lib/core.js'); await KV.set(env,KV_BCAST,{mode:'text_preview',text:payload,by:chatId}); const kb={ inline_keyboard:[ [{text:'✅ Kirim',callback_data:'OPEN_CMD|/confirm_broadcast'}, {text:'❌ Batal', callback_data:'OPEN_CMD|/cancel_broadcast'} ] ] }; await sendMessage(s,env,chatId,`📝 *Preview Broadcast:*\n${payload}`,kb); return new Response('OK',{status:200}); }
        if(text.startsWith('/cancel_broadcast')){ const { KV, KV_BCAST } = await import('./lib/core.js'); await KV.set(env,KV_BCAST,null); await sendMessage(s,env,chatId,'🛑 Broadcast dibatalkan.'); return new Response('OK',{status:200}); }
        if(text.startsWith('/status_broadcast')){ const { KV, KV_BCAST } = await import('./lib/core.js'); const st=await KV.get(env,KV_BCAST); await sendMessage(s,env,chatId,'🧾 Status broadcast:\n'+('```json\n'+JSON.stringify(st||{},null,2)+'\n```')); return new Response('OK',{status:200}); }
        if(text.startsWith('/confirm_broadcast')){ if(!isAdmin){ await sendMessage(s,env,chatId,'🙏 Mohon maaf, fitur ini hanya untuk admin.'); return new Response('OK',{status:200}); } const { KV, KV_BCAST, KV_SUBS, sleep } = await import('./lib/core.js'); const st=await KV.get(env,KV_BCAST); if(!st){ await sendMessage(s,env,chatId,'Tidak ada broadcast aktif.'); return new Response('OK',{status:200}); } const subs=new Set((await KV.get(env,KV_SUBS))||[]); let ok=0; if(st.mode==='text_preview'){ for(const uid of subs){ try{ await sendMessage(s,env,uid,st.text); ok++; }catch{} await sleep(25); } } await KV.set(env,KV_BCAST,null); await sendMessage(s,env,chatId,`📤 Broadcast terkirim ke *${ok}* pengguna.`); return new Response('OK',{status:200}); }

        // Fallback
        if(text){ await sendMessage(s,env,chatId,'Pesan diterima ✅'); }
        return new Response('OK',{status:200});
      }

      return new Response('OK',{status:200});
    }catch(e){ console.error(e); return new Response('Bad Request',{status:400}); }
  }
};
