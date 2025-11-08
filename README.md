# 🤖 Telegram Botku — Cloudflare Worker Edition

Bot Telegram canggih berbasis **Cloudflare Workers** untuk membantu pembuatan **VLESS / TROJAN**, cek kuota via API DOMPUL, ambil proxy random, kirim broadcast teks/gambar, dan masih banyak lagi.

---

## ⚙️ Fitur Utama

### 👤 Menu User
- 🌐 Get Random Proxy (grid negara + flag emoji)
- 🔎 Cek Kuota (memakai API_DOMPUL)
- 🏓 Ping latency bot
- 📊 Bandwidth Cloudflare (dari GraphQL API)
- 👤 User Detail

### 🛡️ Menu Admin
- 📢 Broadcast Teks (ke semua user)
- 🖼 Broadcast Gambar (via gallery / file_id)
- 📋 List User (10 per halaman)
- 📊 Bandwidth Cloudflare
- 🏓 Ping Test

### 🎁 Support Menu
Tombol tambahan di menu utama:
- Menampilkan gambar dari URL `SUPPORT_IMAGE_URL`
- Dilengkapi teks lucu:  
  > "Buah Cengkudu Buah Tomat Oh ya ammpun di lihat 🤣🤣"

---

## 🚀 Deploy ke Cloudflare Workers

### 1️⃣ Install Wrangler

`bash
npm install -g wrangler`

### 2️⃣ Buat Namespace KV

`wrangler kv:namespace create DATA_DB`

Catat ID hasilnya, lalu isi ke wrangler.toml.
---

### 3️⃣ Isi File Konfigurasi

`wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put PASSUID
wrangler secret put ADMIN_ID              # contoh: 797659707,123456
wrangler secret put CLOUDFLARE_API_TOKEN  # opsional untuk /bandwidth
wrangler secret put CLOUDFLARE_ZONE_ID    # opsional untuk /bandwidth`

Edit wrangler.toml sesuai data kamu:

``
name = "botku"
main = "src/botku.js"
compatibility_date = "2025-11-08"``

`[[kv_namespaces]]
binding = "DATA_DB"
id = "<KV_NAMESPACE_ID>"`

`[vars]
SERVERVLESS = "vless.example.com"
SERVERTROJAN = "trojan.example"
SERVERWILDCARD = "wc.example.com"
API_URL = "https://ip.example.com/api?ip="
API_DOMPUL = "http://api.example.com/cek_kuota?msisdn="
SUPPORT_IMAGE_URL = "https://raw.githubusercontent.com/muhaip2/botku/a0421fca48e383cf05a3a49114702c924b571745/Kode%20QR.jpg"
WATERMARK = " ADMIN t.me/swdstore2"`


---

### 4️⃣ Tambahkan Secrets (data rahasia)

`wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put PASSUID
wrangler secret put ADMIN_ID              # contoh: 2345678,123456
wrangler secret put CLOUDFLARE_API_TOKEN  # opsional untuk /bandwidth
wrangler secret put CLOUDFLARE_ZONE_ID    # opsional untuk /bandwidth`

---
### 5️⃣ Deploy!

`wrangler deploy`

---
### 6️⃣ Set Webhook Bot Telegram

`https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-worker-subdomain>/webhook`

Cek status webhook:

`https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo`

Biar lebih mudah kalian bisa setWebhook di bot telegramku :

[Bot setWebhook](t.me/arayamete_bot)


🧩 Command yang Tersedia

🧍 Untuk User

Command	Fungsi

/start | /menu	Pesan sambutan & tombol menu
.cek <no>	Cek kuota via API_DOMPUL
/getrandomproxy	Ambil proxy random per negara
/bandwidth	Cek statistik Cloudflare
/userdetail	Detail pengguna


🛡️ Untuk Admin

Command	Fungsi

/broadcast <pesan>	Kirim teks ke semua user
/broadcastimage	Kirim gambar ke semua user
/listuser	Lihat daftar user (10 per halaman)
/bandwidth	Statistik bandwidth
.ping	Test respon bot



---

💾 Tips Penggunaan

Untuk broadcast gambar, balas foto dengan caption /broadcastimage

Untuk cek kuota, tekan tombol cek kuota lalu masukkan nomor dengan awalan 628

Semua data user disimpan di KV namespace DATA_DB

Admin bisa diatur di ENV ADMIN_ID (pisahkan dengan koma jika lebih dari satu)



---

🧠 Tech Stack

JavaScript (Service Worker style)

Cloudflare Workers KV

Telegram Bot API

GraphQL (Cloudflare Analytics)

Proxy List GitHub raw



---

🧑‍💻 Kontributor

TELEGRAM

> [SWD VPN STORE](t.me/swdstore2)

Terima kasih para suhu 😊

> Sonzai X シ
> 𝙍𝙞𝙯𝙠𝙞𝙃𝙙𝙮𝙩
> ᠌ℤ𝔼ℝ𝕆
> Noir7R
> Black Swan♤
> ▄︻デGeo project══━一
> ➥ DARK ✘ SYSTEM㋡

📜 Lisensi

MIT License © 2025
Gunakan dengan bijak — proyek ini dibuat untuk edukasi & manajemen proxy pribadi.
