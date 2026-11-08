# E-Voting HMTI — Versi HTML/CSS/JS Murni

Tanpa React/Next.js — hanya HTML, CSS, dan JavaScript biasa. Library dimuat lewat `<script>` CDN (Supabase, PapaParse, GSAP, ethers.js), jadi **aplikasi webnya tidak perlu `npm install` atau proses build**. (Folder `blockchain/` punya `npm` sendiri, hanya untuk menguji kontrak.)

## Struktur File

```
index.html               → Login/register mahasiswa            (logic: js/Userpage.js)
landing.html             → Landing page pemilih setelah login   (logic: js/Landing.js)
forgot-password.html     → Lupa password                        (logic: js/Forgotpassword.js)
admin.html               → Login/register admin                 (logic: js/Adminpage.js)

admin/
  konfirmasi.html        → Setujui/tolak pendaftaran mahasiswa  (js/Konfirmasi.js)
  kandidat.html          → Data kandidat (card + form tambah)   (js/Kandidat.js)
  sesi-voting.html       → Buka/tutup sesi lewat blockchain     (js/Sesivoting.js)
  list-voting.html       → Status voting + ekspor CSV SKP       (js/Listvoting.js)
  tambah-siswa.html      → Upload CSV data mahasiswa            (js/Tambahsiswa.js)

css/
  style.css              → Styling global & komponen bersama (modal, card kandidat, tabel, sidebar)
  landing.css            → Styling khusus landing page

js/
  Supabaseclient.js      → Konfigurasi koneksi Supabase (WAJIB diisi)
  Auth.js                → Fungsi register/login/reset password (dipakai bersama)
  Sidebar.js             → Sidebar admin + penjagaan akses admin (semua halaman dashboard)
  Blockchainconfig.js    → Alamat kontrak, jaringan, RPC, ABI (WAJIB diisi setelah deploy)
  Blockchain.js          → Fungsi bersama membaca kontrak (dipakai landing & admin)

blockchain/
  VotingSession.sol      → Smart contract: sesi, paslon, dan penghitungan suara
  PANDUAN_DEPLOY.md      → Cara mendeploy kontrak (Remix + MetaMask, Sepolia)
  test/VotingSession.test.js → Pengujian kontrak (npm install && npm test)

relayer/
  relayer.js             → Program yang mengirim antrian suara ke kontrak (npm start)
  PANDUAN_RELAYER.md     → Cara menyiapkan & menjalankan relayer
  buat-wallet.js         → Membuat wallet relayer baru (npm run buat-wallet)
  .env.example           → Contoh pengaturan (salin menjadi .env, JANGAN dibagikan)

supabase/
  schema.sql             → Skema database lengkap
```

## 1. Setup / Update Database

Buka **Supabase → SQL Editor**, jalankan **seluruh isi `supabase/schema.sql`**.

File ini aman untuk dua kondisi:
- **Database lama Anda** (masih ada tabel `profiles` & `mahasiswa_whitelist`): tabel otomatis di-**rename**, seluruh data & akun tetap utuh.
- **Database baru/kosong**: semua tabel dibuat dari awal.

Skrip juga aman dijalankan berulang kali.

### Penamaan tabel

| Tabel | Fungsi | Sebelumnya |
|---|---|---|
| `tb_pengguna` | Akun login mahasiswa & admin, status persetujuan, status sudah voting | `profiles` |
| `tb_kandidat` | Data calon Ketua + `foto_path` (menu Kandidat) | *baru* |
| `tb_log_admin` | Riwayat buka/tutup sesi voting yang tampil di landing page | *baru* |
| `tb_suara` | Suara anonim — **tidak punya kolom yang menunjuk ke pemilih** | *baru* |

### Foto kandidat

Foto disimpan di **Supabase Storage** (bucket `foto-kandidat`, dibuat otomatis oleh `schema.sql`), sedangkan lokasi filenya dicatat di kolom `tb_kandidat.foto_path`. Batas: JPG/PNG/WEBP, maksimal 2 MB. Hanya admin yang boleh upload/hapus; foto bisa dilihat semua pemilih. Saat kandidat dihapus atau fotonya diganti, file lama ikut dibersihkan.

## 2. Kredensial Supabase

Isi dua baris di `js/Supabaseclient.js` (Supabase → Settings → API):

```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "isi-dengan-anon-public-key-anda";
```

### Sesi login admin dan mahasiswa dipisah

Sesi login admin dan mahasiswa disimpan dengan kunci berbeda di browser (`evoting-admin-auth` dan `evoting-user-auth`, diatur di `js/Supabaseclient.js`). Jadi Anda bisa menguji admin dan mahasiswa **di browser yang sama** tanpa saling menghapus sesi. Semua halaman dashboard admin juga memeriksa dulu bahwa yang membukanya admin yang sedang login; jika tidak, otomatis dialihkan ke halaman login admin.

> Setelah memasang versi ini, login sekali lagi (sesi lama tersimpan di kunci yang berbeda).

### Notifikasi (toast)

Kode toast ada langsung di bagian atas `Kandidat.js`, `Konfirmasi.js`, `Listvoting.js`, dan `Tambahsiswa.js` (fungsi `showToast`). Tampilannya diatur di `css/style.css` bagian **TOAST**.

## 2b. Blockchain: sesi dan suara

Smart contract `blockchain/VotingSession.sol` mencatat sesi voting, daftar nomor paslon, dan
suara anonim. Ikuti **`blockchain/PANDUAN_DEPLOY.md`** untuk mendeploy kontrak, lalu
**`relayer/PANDUAN_RELAYER.md`** untuk menjalankan relayer.

Alur satu suara:

```
Mahasiswa -> fungsi database -> antrian suara (tanpa identitas) -> RELAYER -> smart contract
```

1. Mahasiswa menekan **Ya, Kirim Suara**. Satu fungsi database memeriksa hak pilih, sesi, dan status
   belum memilih; lalu dalam satu transaksi menandai `has_voted = true` **dan** memasukkan nomor
   paslon ke antrian (`tb_antrian_suara`) yang **tidak memuat identitas maupun waktu memilih**.
2. **Relayer** (program di `relayer/`, memakai wallet terpisah yang membayar gas) mengambil antrian
   dalam **urutan acak** dan mengirimnya ke kontrak. Saat sesi berlangsung: tiap `INTERVAL_MENIT`
   (bawaan 30) dan hanya jika suara menunggu minimal `MIN_BATCH` (bawaan 5).
3. Setiap suara membawa ID acak; kontrak menolak ID yang sudah dihitung. Jadi relayer yang mati di
   tengah jalan aman dijalankan lagi: suara tidak hilang dan tidak terhitung dua kali.
4. **Menutup sesi bertahap** (halaman admin Sesi Voting): (a) database berhenti menerima suara baru,
   (b) relayer mengirim semua sisa antrian, (c) baru sesi ditutup di blockchain lewat MetaMask.
   Jika relayer tidak berjalan, penutupan menunggu, dan admin bisa membatalkannya.
5. Setelah ditutup, **hasil akhir** dibaca dari kontrak dan ditampilkan di halaman admin serta
   landing page mahasiswa.

Hal lain yang perlu diketahui:
- **Blockchain adalah sumber kebenaran** status sesi dan hitungan suara. Status sesi disalin ke
  tabel `tb_sesi_voting` setelah transaksi terkonfirmasi, karena database tidak bisa membaca
  blockchain langsung; salinan itulah yang dipakai server untuk menolak suara di luar sesi.
- **Data kandidat dikunci** begitu sesi dibuka (nomor paslon didaftarkan permanen di kontrak).
- **Pemeriksaan konsistensi** (admin dan landing page): jumlah suara di blockchain harus sesuai
  dengan jumlah mahasiswa yang tercatat memilih dan isi antrian. Perbedaan menampilkan peringatan.
- Riwayat buka/tutup sesi dan hasil di landing page dibaca **langsung dari blockchain** lewat RPC
  publik, bukan dari database aplikasi.

## 3. Menjalankan

Pakai server lokal sederhana (membuka lewat `file://` bisa diblokir browser):
- VS Code: ekstensi **Live Server** → klik kanan `index.html` → *Open with Live Server*
- atau `python3 -m http.server 3000` lalu buka `http://localhost:3000`

## 4. Alur Pengujian

1. Daftar & login admin di `admin.html`
2. Menu **Kandidat** → **+ Tambah Kandidat** → isi minimal 2 paslon
3. Daftar mahasiswa di `index.html` → admin setujui lewat **Konfirmasi Pendaftaran**
4. Login sebagai mahasiswa → masuk ke `landing.html`: nama tampil di header, kandidat tampil, klik **Pilih Paslon** → popup konfirmasi → **Ya, Kirim Suara**
5. Menu **List Voting** menampilkan mahasiswa tsb berstatus *Sudah Voting*

6. Deploy kontrak, jalankan relayer, lalu menu **Sesi Voting**: hubungkan MetaMask → **Mulai Sesi Voting** → konfirmasi. Tombol "Pilih Paslon" di sisi mahasiswa baru aktif setelah ini.
7. Setelah mahasiswa memilih, relayer mengirim suara ke blockchain (untuk mencoba cepat: `MIN_BATCH=1`, `INTERVAL_MENIT=1` di `relayer/.env`, atau `npm run paksa`).
8. **Tutup Sesi Voting** → sisa suara dikirim → konfirmasi penutupan di MetaMask → **Hasil Akhir** tampil.

## 5. Catatan Penting (Status Fase Ini)

- **Kerahasiaan pilihan bergantung pada server.** Blockchain menjamin hasil hitungan tidak bisa diubah, tetapi server melihat pasangan (pemilih, pilihan) sesaat sebelum memisahkannya. Pengacakan urutan dan batas minimal batch mengurangi risiko pencocokan lewat waktu, namun bukan jaminan kriptografis (blind signature / zero-knowledge berada di luar lingkup). Tulis ini sebagai batasan dan saran pengembangan.
- **Hitungan sementara dapat dibaca publik.** Semua data blockchain publik, jadi hitungan per paslon bisa dibaca siapa saja kapan saja (berubah saat relayer mengirim batch). Aplikasi hanya menampilkan hasil setelah sesi ditutup.
- **Penegakan sesi di sisi server memakai salinan database.** Admin yang mengendalikan database secara teknis bisa mengubah salinan itu, tetapi status tidak bisa mundur (penjaga di database), catatan buka/tutup tidak bisa diubah setelah terisi, dan landing page membandingkannya dengan blockchain sehingga perbedaan terlihat.
- **Suara yang menunggu di antrian bisa dilihat pemilik database.** Selama menunggu dikirim (hingga satu interval), pilihan (tanpa identitas) ada di tabel antrian. Setelah terkirim, suara terkunci di blockchain.
- **Relayer harus berjalan.** Jika mati, suara tertunda (tidak hilang) dan penutupan sesi menunggu. Lihat `relayer/PANDUAN_RELAYER.md`.
- **Kontrak tidak punya batas waktu otomatis.** Sesi dibuka dan ditutup manual oleh admin.
- **Data uji lama.** Akun yang sudah `has_voted` dari versi sebelumnya (suara di tabel lama `tb_suara`) membuat pemeriksaan konsistensi menampilkan peringatan; reset dengan SQL di bagian "Pemilihan baru" pada `blockchain/PANDUAN_DEPLOY.md`.
- **Tabel `tb_log_admin` dan `tb_suara` sudah tidak dipakai.** Aman dibiarkan atau dihapus.
- **Halaman admin disembunyikan, bukan dikunci.** Tautan ke `admin.html` sudah dihapus dari halaman mahasiswa, tetapi halamannya tetap bisa dibuka jika alamatnya diketahui, dan database masih menerima pendaftaran admin dari siapa pun yang memiliki anon key (yang memang tampil di `Supabaseclient.js` di browser). Sebelum dipakai sungguhan, tambahkan kode rahasia pendaftaran admin atau tutup pendaftaran admin setelah admin pertama dibuat.
- **Jaringan uji.** Konfigurasi bawaan memakai Sepolia (tanpa uang sungguhan). RPC publik bawaan di `Blockchainconfig.js` bisa lambat; ganti dengan RPC gratis dari Alchemy/Infura bila perlu.