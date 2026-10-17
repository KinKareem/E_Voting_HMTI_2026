# E-Voting HMTI — Versi HTML/CSS/JS Murni

Tanpa React/Next.js — hanya HTML, CSS, dan JavaScript biasa. Library dimuat lewat `<script>` CDN (Supabase, PapaParse, GSAP), jadi **tidak perlu `npm install` atau proses build**.

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
| `tb_pengguna` | Akun login mahasiswa & admin, status persetujuan, status sudah voting | `profiles` |
| `tb_mahasiswa` | Data master mahasiswa hasil upload CSV (menu Tambah Siswa) | `mahasiswa_whitelist` |
| `tb_kandidat` | Pasangan calon (menu Kandidat) | *baru* |
| `tb_log_admin` | Riwayat buka/tutup sesi voting yang tampil di landing page | *baru* |
| `tb_suara` | Suara anonim — **tidak punya kolom yang menunjuk ke pemilih** | *baru* |

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

### Mencoba tampilan Riwayat Aktivitas

Karena fitur buka/tutup sesi belum dibangun (akan menyusul bersama blockchain), isi log secara manual lewat SQL Editor untuk melihat tampilannya:

```sql
insert into public.tb_log_admin (jenis_aksi, wallet_address) values
  ('buka_sesi',  '0x7A3f8b92c1d4e5f6a7b8c9d0e1f2a3b4c5d69e21'),
  ('tutup_sesi', '0x7A3f8b92c1d4e5f6a7b8c9d0e1f2a3b4c5d69e21');
```

Landing page memperbarui log otomatis tiap 30 detik. Kolom `wallet_address` boleh kosong; jika diisi, tampil terpotong (`0x7A3f...9e21`).

## 5. Catatan Penting (Status Fase Ini)

- **Pengiriman suara masih sementara.** Saat ini suara disimpan lewat fungsi database `fn_kirim_suara` ke tabel `tb_suara` (tanpa identitas pemilih), dan akun ditandai `has_voted = true` dalam satu transaksi — sehingga *one person, one vote* sudah ditegakkan di sisi server. Pada fase blockchain, bagian "simpan ke `tb_suara`" akan diganti pengiriman ke smart contract.
- **Voting belum dibatasi sesi.** Karena menu buka/tutup sesi belum ada, pemilih yang sudah login bisa memberi suara kapan saja. Pembatasan ini ditambahkan saat fitur sesi dibangun.
- **Registrasi admin masih terbuka** (sesuai spesifikasi awal: admin tanpa konfirmasi) — artinya siapa pun yang tahu alamat `admin.html` bisa mendaftar sebagai admin. Disarankan menambah kode rahasia pendaftaran atau mengunci pendaftaran admin sebelum dipakai sungguhan.
