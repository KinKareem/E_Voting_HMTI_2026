# E-Voting HMTI — Versi HTML/CSS/JS Murni

## Struktur File

```
index.html               → Login/register mahasiswa            (logic: js/Userpage.js)
landing.html             → Landing page pemilih setelah login   (logic: js/Landing.js)
forgot-password.html     → Lupa password                        (logic: js/Forgotpassword.js)
admin.html               → Login/register admin                 (logic: js/Adminpage.js)

admin/
  konfirmasi.html        → Setujui/tolak pendaftaran mahasiswa  (js/Konfirmasi.js)
  kandidat.html          → Data kandidat (card + form tambah)   (js/Kandidat.js)
  list-voting.html       → Status voting + ekspor CSV SKP       (js/Listvoting.js)
  tambah-siswa.html      → Upload CSV data mahasiswa            (js/Tambahsiswa.js)

css/
  style.css              → Styling global & komponen bersama (modal, card kandidat, tabel, sidebar)
  landing.css            → Styling khusus landing page

js/
  Supabaseclient.js      → Konfigurasi koneksi Supabase (WAJIB diisi)
  Auth.js                → Fungsi register/login/reset password (dipakai bersama)
  Sidebar.js             → Sidebar admin (dipakai semua halaman dashboard)

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
| `tb_pengguna` | Akun login mahasiswa & admin, status persetujuan, status sudah voting 
| `tb_mahasiswa` | Data master mahasiswa hasil upload CSV (menu Tambah Siswa) 
| `tb_kandidat` | Pasangan calon (menu Kandidat) | *baru* |
| `tb_log_admin` | Riwayat buka/tutup sesi voting yang tampil di landing page 
| `tb_suara` | Suara anonim — **tidak punya kolom yang menunjuk ke pemilih** 

## 2. Kredensial Supabase

Isi dua baris di `js/Supabaseclient.js` (Supabase → Settings → API):

```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "isi-dengan-anon-public-key-anda";
```

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
