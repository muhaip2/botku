// util umum + format
export const ts = ()=>Date.now();
export const sleep = ms=>new Promise(r=>setTimeout(r,ms));

export function todayKeyUTC(off=0){
  const d=new Date(); d.setUTCDate(d.getUTCDate()+off);
  const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const dd=String(d.getUTCDate()).padStart(2,'0');
  return `${y}${m}${dd}`;
}
export function lastNDaysKeys(n){ const out=[]; for(let i=n-1;i>=0;i--) out.push(todayKeyUTC(-i)); return out; }

export function bytesHuman(n){ if(!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(x>=100?0:x>=10?1:2)} ${u[i]}`;}
export function formatNowTZ(tz){ try{ return new Date().toLocaleString('id-ID',{ timeZone: tz, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }); }catch{ return new Date().toISOString(); } }

export function ccToFlag(cc){ const A=0x1F1E6; const c=cc.toUpperCase(); return String.fromCodePoint(A+(c.charCodeAt(0)-65))+String.fromCodePoint(A+(c.charCodeAt(1)-65)); }
export function applyWatermark(text, s){ const wm=(s.ADMIN_WATERMARK||'').trim(); if(!wm) return text; return s.WATERMARK_POSITION==='top'?`${wm}\n${text}`:`${text}\n${wm}`; }

// sparkline mini
const SPARK=['▁','▂','▃','▄','▅','▆','▇','█'];
export function spark(a){ if(!a.length) return '(no data)'; const mn=Math.min(...a), mx=Math.max(...a); if(mx===mn) return SPARK[0].repeat(a.length); return a.map(v=>SPARK[Math.floor((v-mn)/(mx-mn)*(SPARK.length-1))]).join(''); }

// wildcard helper
export function wildcardHostByKey(s,key){ const v=s.WILDCARD_MAP[key]; if(!v) return null; if(v.includes('.')) return v; if(!s.SERVER_WILDCARD) return null; return `${v}.${s.SERVER_WILDCARD}`; }
