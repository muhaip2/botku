import { KV, KV_TRAFFIC_DAILY, todayKeyUTC, applyWatermark } from './core.js';

// bandwidth tracking
export async function trackTraffic(env, bytes){
  const key=KV_TRAFFIC_DAILY+todayKeyUTC();
  const cur=await KV.get(env,key)||{bytesOut:0};
  cur.bytesOut=(cur.bytesOut||0)+Math.max(0, bytes|0);
  await KV.set(env,key,cur);
}

export async function sendMessage(s, env, chat_id, text, reply_markup=null){
  const body={chat_id,text:applyWatermark(text,s),parse_mode:'Markdown',disable_web_page_preview:true};
  if(reply_markup) body.reply_markup=reply_markup;
  const payload=JSON.stringify(body);
  await trackTraffic(env,payload.length);
  const r=await fetch(s.TELEGRAM_API_URL+'sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  return r.json().catch(()=>({}));
}

export async function editMessage(s, env, chat_id, message_id, text, reply_markup=null){
  const body={chat_id,message_id,text:applyWatermark(text,s),parse_mode:'Markdown',disable_web_page_preview:true};
  if(reply_markup) body.reply_markup=reply_markup;
  const payload=JSON.stringify(body);
  await trackTraffic(env,payload.length);
  const r=await fetch(s.TELEGRAM_API_URL+'editMessageText',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  return r.json().catch(()=>({}));
}

export async function answerCallback(s,id,text=null,show=false){
  const body={callback_query_id:id};
  if(text){body.text=text; body.show_alert=show;}
  await fetch(s.TELEGRAM_API_URL+'answerCallbackQuery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}

export async function sendPhoto(s, env, chat_id, photo, caption=''){
  const body={chat_id,photo,caption:applyWatermark(caption||'',s),parse_mode:'Markdown'};
  const payload=JSON.stringify(body);
  await trackTraffic(env,payload.length);
  const r=await fetch(s.TELEGRAM_API_URL+'sendPhoto',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  return r.json().catch(()=>({}));
}
