// === MESSAGE ===
if (body.message) {
  const msg = body.message;
  const chatId   = String(msg.chat.id);
  const chatType = String(msg.chat.type || 'private');
  const first    = (msg.from?.first_name) || '';
  const username = msg.from?.username ? ('@' + msg.from.username) : '';
  const isAdmin  = settings.ADMIN_IDS.map(String).includes(chatId);
  const text     = (msg.text || '').trim();

  // catat user
  await addSubscriber(env, chatId).catch(()=>{});
  await statsTrack(env, chatId, username, chatType, 'message').catch(()=>{});
  await ensureTotalUsers(env).catch(()=>{});

  // 1) START / MENU — selalu tangani duluan
  if (/^\/(start|menu)\b/i.test(text)) {
    const hello =
`Halo *${first}*, aku adalah asisten pribadimu.
Tolong rawat aku ya seperti kamu merawat diri sendiri 😘

👤 Nama: *${first}* ${username?`(${username})`:''}
🆔 ID: \`${chatId}\`
🕒 Waktu: _${formatNowTZ(settings.TIMEZONE)}_`;
    await sendMessage(settings, env, chatId, hello, K_MAIN);
    return new Response('OK', { status: 200 });
  }

  // 2) Menu User
  if (text === '/menu_user') {
    await sendMessage(settings, env, chatId, '*Menu User*', K_USER());
    return new Response('OK', { status: 200 });
  }

  // 3) Menu Admin
  if (text === '/menu_admin') {
    if (!isAdmin) {
      await sendMessage(settings, env, chatId, '🙏 Mohon maaf, fitur ini hanya untuk admin.');
      return new Response('OK', { status: 200 });
    }
    await sendMessage(settings, env, chatId,
      '*Menu Admin*\n• Broadcast teks/foto (galeri)\n• Stats & tren 7 hari\n• Kelola pool proxy.',
      K_ADMIN());
    return new Response('OK', { status: 200 });
  }

  // … (perintah lain tetap seperti sebelumnya) …

  // 99) Jangan spam fallback — cukup diam jika tak dikenal
  return new Response('OK', { status: 200 });
}
