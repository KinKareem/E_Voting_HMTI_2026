# E-Voting HMTI — Versi HTML/CSS/JS Murni

Aplikasi e-voting pemilihan Ketua HMTI yang dibuat tanpa React/Next.js — hanya HTML, CSS, dan JavaScript biasa. Library dimuat lewat `<script>` CDN (Supabase, PapaParse, GSAP, ethers.js), jadi **aplikasi webnya tidak perlu `npm install` atau proses build**. (Folder `blockchain/` punya `npm` sendiri, hanya untuk menguji kontrak.)

Sistem ini terdiri dari tiga bagian yang bekerja bersama:

| Bagian | Peran |
|---|---|
| **Web (HTML/CSS/JS)** | Antarmuka mahasiswa dan admin: pendaftaran, login, kandidat, voting, sesi, dan hasil |
| **Supabase** | Database (akun, kandidat, antrian suara), penyimpanan file (foto kandidat dan KTM), dan fungsi database |
| **Blockchain (smart contract)** | Mencatat sesi voting, daftar nomor paslon, dan hitungan suara |

## Struktur File

```
index.html               → Login/register mahasiswa            (logic: js/Userpage.js)
landing.html             → Landing page pemilih setelah login   (logic: js/Landing.js)
forgot-password.html     → Lupa password                        (logic: js/Forgotpassword.js)
admin.html               → Login admin (tanpa register)                (logic: js/Adminpage.js)

admin/
  konfirmasi.html        → Setujui/tolak pendaftaran mahasiswa  (js/Konfirmasi.js)
  kandidat.html          → Data kandidat (card + form tambah)   (js/Kandidat.js)
  sesi-voting.html       → Buka/tutup sesi lewat blockchain     (js/Sesivoting.js)
  list-voting.html       → Status voting + ekspor CSV SKP       (js/Listvoting.js)

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

supabase/
  schema.sql             → Skema database lengkap
```

## 1. Setup / Update Database

Buka **Supabase → SQL Editor**, jalankan **seluruh isi `supabase/schema.sql`**.

File ini aman untuk dua kondisi:
- **Database lama Anda** (masih ada tabel `profiles` & `mahasiswa_whitelist`): tabel otomatis di-**rename**, seluruh data & akun tetap utuh.
- **Database baru/kosong**: semua tabel dibuat dari awal.

Skrip juga aman dijalankan berulang kali.

### Tabel

| Tabel | Fungsi |
|---|---|
| `tb_pengguna` | Akun mahasiswa & admin, status persetujuan (`pending`/`approved`/`rejected`), status sudah voting, dan lokasi file KTM |
| `tb_kandidat` | Data calon Ketua (nomor paslon, nama, visi, misi, catatan) + `foto_path` |
| `tb_sesi_voting` | Status sesi: `belum_mulai` → `berlangsung` → `menutup` → `selesai`. Hanya satu baris |
| `tb_antrian_suara` | Antrian suara yang menunggu dikirim relayer ke blockchain (status `menunggu` / `diproses` / `terkirim`) |
| `tb_status_relayer` | Kondisi relayer: aktif atau dijeda, terakhir kirim, total terkirim, error terakhir |
| `tb_pengaturan_kontrak` | Alamat kontrak `VotingSession` yang sedang aktif |
| `tb_riwayat_kontrak` | Jejak setiap penggantian alamat kontrak |
| `tb_log_admin` | Tidak lagi dipakai (riwayat sesi dibaca langsung dari blockchain). Aman dibiarkan atau dihapus |

### Fungsi database

| Fungsi | Dipanggil oleh | Tugas |
|---|---|---|
| `fn_daftar_mahasiswa` | Mahasiswa saat mendaftar | Menghubungkan akun login dengan data NIM dan menyimpan lokasi file KTM |
| `fn_admin_tolak_pendaftaran` | Admin | Menolak pendaftaran: menghapus file KTM dan akunnya |
| `fn_kirim_suara` | Mahasiswa saat memilih | Memeriksa hak pilih dan sesi, menandai sudah memilih, lalu memasukkan suara ke antrian |
| `fn_ringkasan_suara` | Landing page & admin | Ringkasan jumlah mahasiswa yang memilih dan isi antrian |
| `fn_set_kontrak` | Admin (menu Sesi Voting) | Mengganti alamat kontrak aktif, opsional mereset data pemilihan lama |
| `fn_set_relayer_aktif` | Admin | Menjeda atau mengaktifkan relayer |
| `fn_ambil_batch_suara`, `fn_tandai_batch_terkirim`, `fn_lepas_batch`, `fn_lepas_kedaluwarsa` | Relayer | Mengambil batch suara, menandainya terkirim, mengembalikannya ke antrian, atau melepas batch yang tersangkut |

### Penyimpanan file (Supabase Storage)

- **`foto-kandidat`** — foto pasangan calon. Format JPG/PNG/WEBP, maksimal 2 MB. Hanya admin yang boleh upload/hapus; foto tampil untuk semua pemilih. Saat kandidat dihapus atau fotonya diganti, file lama ikut dibersihkan.
- **`ktm-mahasiswa`** — scan KTM (PDF) yang diunggah mahasiswa saat mendaftar. Admin melihatnya lewat tombol **Lihat Gambar** di halaman Konfirmasi Pendaftaran.

## 2. Konfigurasi Supabase

Isi konfigurasi koneksi di `js/Supabaseclient.js` (URL dan key proyek dari Supabase → Settings → API).

### Sesi login admin dan mahasiswa dipisah

Sesi login admin dan mahasiswa disimpan dengan kunci berbeda di browser (`evoting-admin-auth` dan `evoting-user-auth`, diatur di `js/Supabaseclient.js`). Jadi Anda bisa menguji admin dan mahasiswa **di browser yang sama** tanpa saling menghapus sesi. Semua halaman dashboard admin memeriksa dulu bahwa yang membukanya adalah admin yang sedang login; jika tidak, otomatis dialihkan ke halaman login admin.

> Setelah memasang versi ini, login sekali lagi (sesi lama tersimpan di kunci yang berbeda).

### Notifikasi (toast)

Kode toast ada langsung di bagian atas `Kandidat.js`, `Konfirmasi.js`, dan `Listvoting.js` (fungsi `showToast`). Tampilannya diatur di `css/style.css` bagian **TOAST**.

## 3. Cara Kerja Sistem

### 3.1 Pendaftaran dan persetujuan

```
Mahasiswa daftar (NIM, nama, email, password, KTM PDF)
      -> akun berstatus "pending"
      -> admin meninjau KTM di Konfirmasi Pendaftaran
      -> disetujui ("approved") atau ditolak
      -> mahasiswa yang disetujui dapat login memakai NIM dan password
```

### 3.2 Menyiapkan pemilihan (admin)

1. Menu **Kandidat**: tambahkan minimal 2 pasangan calon beserta foto.
2. Menu **Sesi Voting**: hubungkan MetaMask, lalu atur alamat kontrak `VotingSession` yang sudah di-deploy.
3. Mulai sesi. Nomor paslon didaftarkan ke kontrak, dan data kandidat **dikunci** sejak saat ini.

### 3.3 Alur satu suara

```
Mahasiswa -> fungsi database -> antrian suara -> RELAYER -> smart contract
```

1. Mahasiswa membuka landing page, melihat kandidat, lalu menekan **Pilih Paslon** dan **Ya, Kirim Suara**. Satu fungsi database memeriksa hak pilih, status sesi, dan apakah mahasiswa sudah memilih. Dalam satu transaksi, fungsi itu menandai `has_voted = true` **dan** memasukkan nomor paslon ke antrian suara (`tb_antrian_suara`).
2. **Relayer** (wallet terpisah yang membayar gas) mengambil antrian dalam **urutan acak** dan mengirimnya ke kontrak. Saat sesi berlangsung, pengiriman dilakukan tiap `INTERVAL_MENIT` (bawaan 30) dan hanya jika suara yang menunggu minimal `MIN_BATCH` (bawaan 5).
3. Setiap suara membawa ID acak, dan kontrak menolak ID yang sudah dihitung. Jadi relayer yang berhenti di tengah jalan aman dijalankan lagi: suara tidak hilang dan tidak terhitung dua kali.
4. Status suara di antrian berubah `menunggu` → `diproses` → `terkirim`. Batch yang tersangkut dikembalikan ke `menunggu` setelah melewati batas waktu.

### 3.4 Menjalankan relayer

Relayer dapat dijalankan dengan dua cara:
- **Program Node.js** di folder `relayer/` (`npm start`), lihat `relayer/PANDUAN_RELAYER.md`.
- **Edge Function Supabase** bernama `relayer`, dipanggil otomatis oleh penjadwal database (`pg_cron`) tiap menit selama sesi berstatus `berlangsung` atau `menutup`. Di luar itu tidak ada panggilan. Admin dapat menjeda relayer lewat saklar di halaman Sesi Voting.

### 3.5 Menutup sesi bertahap

Penutupan dilakukan lewat halaman admin **Sesi Voting**:

1. Database berhenti menerima suara baru (status `menutup`).
2. Relayer mengirim semua sisa antrian, berapa pun jumlahnya.
3. Setelah antrian kosong, sesi ditutup di blockchain lewat MetaMask (status `selesai`).

Jika relayer tidak berjalan, penutupan menunggu, dan admin bisa membatalkannya (kembali ke `berlangsung`).

### 3.6 Hasil akhir

Setelah sesi ditutup, **hasil akhir** dibaca dari kontrak dan ditampilkan di halaman admin serta landing page mahasiswa. Halaman **List Voting** menampilkan status voting tiap mahasiswa dan dapat mengekspor data partisipan ke CSV untuk klaim SKP.

### 3.7 Hal lain yang perlu diketahui

- **Blockchain adalah sumber kebenaran** status sesi dan hitungan suara. Status sesi disalin ke tabel `tb_sesi_voting` setelah transaksi terkonfirmasi, karena database tidak bisa membaca blockchain langsung. Salinan itulah yang dipakai fungsi database untuk menolak suara di luar sesi.
- **Urutan status sesi hanya maju:** `belum_mulai` → `berlangsung` → `menutup` → `selesai`. Satu-satunya langkah mundur yang diizinkan adalah `menutup` → `berlangsung` (membatalkan penutupan). Sesi yang sudah selesai tidak bisa dibuka lagi.
- **Pemeriksaan konsistensi** (halaman admin dan landing page): jumlah suara di blockchain dibandingkan dengan jumlah mahasiswa yang tercatat memilih dan isi antrian. Jika berbeda, muncul peringatan.
- **Riwayat buka/tutup sesi dan hasil** di landing page dibaca langsung dari blockchain lewat RPC publik, bukan dari database aplikasi.
- **Pemilihan baru:** ganti alamat kontrak lewat menu Sesi Voting dengan opsi reset. Status sesi kembali ke `belum_mulai`, antrian suara dikosongkan, dan status "sudah memilih" direset. Akun mahasiswa dan data kandidat tetap.
- **Sesi dibuka dan ditutup manual** oleh admin. Kontrak tidak memakai batas waktu otomatis.
- **Jaringan uji.** Konfigurasi bawaan memakai Sepolia (tanpa uang sungguhan). RPC publik bawaan di `Blockchainconfig.js` bisa lambat; ganti dengan RPC gratis dari Alchemy/Infura bila perlu.

## 4. Menjalankan

Pakai server lokal sederhana (membuka lewat `file://` bisa diblokir browser):
- VS Code: ekstensi **Live Server** → klik kanan `index.html` → *Open with Live Server*
- atau `python3 -m http.server 3000` lalu buka `http://localhost:3000`

## 5. Alur Pengujian

1. Tambah akun admin lewat `supabase/tambah_admin.sql`, lalu login di `admin.html`
2. Menu **Kandidat** → **+ Tambah Kandidat** → isi minimal 2 paslon
3. Daftar mahasiswa di `index.html` (termasuk unggah KTM) → admin setujui lewat **Konfirmasi Pendaftaran**
4. Deploy kontrak, jalankan relayer, lalu menu **Sesi Voting**: hubungkan MetaMask → **Mulai Sesi Voting** → konfirmasi. Tombol "Pilih Paslon" di sisi mahasiswa baru aktif setelah ini.
5. Login sebagai mahasiswa → masuk ke `landing.html`: nama tampil di header, kandidat tampil, klik **Pilih Paslon** → popup konfirmasi → **Ya, Kirim Suara**
6. Menu **List Voting** menampilkan mahasiswa tersebut berstatus *Sudah Voting*
7. Setelah mahasiswa memilih, relayer mengirim suara ke blockchain (untuk mencoba cepat: `MIN_BATCH=1`, `INTERVAL_MENIT=1` di `relayer/.env`, atau `npm run paksa`)
8. **Tutup Sesi Voting** → sisa suara dikirim → konfirmasi penutupan di MetaMask → **Hasil Akhir** tampil