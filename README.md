# YuriBot

Bot Discord ringan untuk memantau dan membagikan anime genre Girls Love (Yuri) memakai data dari MyAnimeList (API Jikan).

## Fitur
- **/list [page]** – menampilkan daftar anime yuri, lengkap dengan tombol Prev/Next.
- **/search query [page]** – mencari anime yuri berdasarkan kata kunci dan menampilkan hingga 5 hasil detail.
- **/yhelp** – menampilkan ringkasan perintah dan info singkat bot.
- Pemantauan berkala: bot menyimpan state pada `data/state.json` untuk mendeteksi judul/episode baru dan mengirim embed otomatis ke channel yang dikonfigurasi.

## Prasyarat
- Node.js 18 atau lebih baru.
- Discord bot token, client ID, dan (opsional) guild ID untuk pendaftaran cepat.

## Instalasi
```bash
npm install
```

## Konfigurasi
Salin `.env.example` menjadi `.env`, lalu isi nilai yang sesuai:

| Variabel | Keterangan |
| --- | --- |
| `DISCORD_TOKEN` | Token bot dari Discord Developer Portal |
| `CLIENT_ID` | Application (client) ID bot |
| `GUILD_ID` | Opsional, ID server untuk pendaftaran slash command instan |
| `CHANNEL_ID` | ID channel teks tujuan notifikasi |
| `CHECK_INTERVAL_MINUTES` | Interval polling data (default 30) |
| `MAX_INITIAL_POSTS` | Batas notifikasi awal saat bot pertama kali berjalan |
| `PAGES_TO_SCAN` | Jumlah halaman daftar yang dipindai tiap siklus |
| `LIST_PER_PAGE` | Jumlah item per halaman (maksimal 25) |
| `JIKAN_BASE` | Endpoint API (default `https://api.jikan.moe/v4`) |
| `JIKAN_GENRE_ID` | ID genre Girls Love (default 26) |
| `STATE_FILE` | Lokasi file state JSON |

## Mendaftarkan Slash Command
Setelah `.env` terisi:
```bash
npm run register
```
- Jika `GUILD_ID` diisi, perintah langsung tersedia pada server tersebut.
- Jika tidak diisi, perintah didaftarkan global (butuh waktu propagasi beberapa menit).

## Menjalankan Bot
```bash
npm start
```

Bot akan menulis state terakhir pada file `data/state.json`. Anda dapat menghapus isi file tersebut jika ingin memulai ulang deteksi (hati-hati jika bot sedang berjalan).

## Catatan Tambahan
- Jikan mempunyai batas ~3 request/detik. Gunakan interval polling yang wajar (30 menit default sudah aman).
- Jika channel tujuan diganti, pastikan nilai `CHANNEL_ID` diperbarui dan bot memiliki izin `View Channel` dan `Send Messages`.
- Error `Unknown interaction` biasanya terjadi ketika respon tombol/perintah melewati batas waktu 3 detik. Bot ini memakai `deferReply`, jadi pastikan koneksi stabil agar request ke API selesai sebelum Discord menutup interaksi.

## Lisensi
Proyek ini tidak menyertakan lisensi. Gunakan seperlunya dan perhatikan ketentuan penggunaan data dari MyAnimeList/Jikan.
