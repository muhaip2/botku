# 🤖 Telegram Bot Worker — Broadcast Gambar + Inline Menu + Stats

Bot Cloudflare Worker siap deploy, dengan fitur:
- Broadcast **teks**, **foto URL**, dan **gambar dari galeri (file_id)** ✅  
- Preview + tombol **Kirim ke semua / Batal** sebelum broadcast  
- Auto-subscribe user baru  
- Statistik & grafik tren 7 hari  
- Inline popup menu (`@YourBot`)  
- Watermark otomatis di bawah setiap pesan  
- Mendukung **gRPC**, **Reality**, dan **Clash YAML export**  

---

## ⚙️ Setup Langkah demi Langkah

### 1️⃣ Siapkan KV Namespace
```bash
wrangler kv:namespace create SUBSCRIBERS
wrangler kv:namespace create --preview SUBSCRIBERS
