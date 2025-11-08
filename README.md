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

## 📂 Struktur Proyek
botku/
├─ src/
│  └─ botku.js
├─ wrangler.toml
├─ .gitignore
└─ README.md

----
---

## 🚀 Deploy ke Cloudflare Workers

### 1️⃣ Install Wrangler
```bash
npm install -g wrangler

wrangler kv:namespace create DATA_DB

wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put PASSUID
wrangler secret put ADMIN_ID              # contoh: 797659707,123456
wrangler secret put CLOUDFLARE_API_TOKEN  # opsional untuk /bandwidth
wrangler secret put CLOUDFLARE_ZONE_ID    # opsional untuk /bandwidth

https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-worker-subdomain>/webhook

https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo

🧩 Command yang Tersedia

🧍 Untuk User

Command	Fungsi

/start / /menu	Pesan sambutan & tombol menu
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

SWD STORE

> Telegram: @swdstore2
