// wrapper KV untuk namespace BOT_DATA
export const KV = {
  async get(env,key){ const raw=await env.BOT_DATA.get(key); if(!raw) return null; try{ return JSON.parse(raw);}catch{ return null; } },
  set(env,key,val){ return env.BOT_DATA.put(key, JSON.stringify(val)); },
  async list(env,prefix){ let cur; const keys=[]; while(true){ const r=await env.BOT_DATA.list({prefix, cursor:cur}); keys.push(...r.keys.map(k=>k.name)); if(!r.list_complete&&r.cursor) cur=r.cursor; else break; } return keys; }
};
