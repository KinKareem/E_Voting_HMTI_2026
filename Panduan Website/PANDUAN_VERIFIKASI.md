# Panduan Verifikasi Sistem E-Voting HMTI

Panduan ini untuk memeriksa tiga hal setelah uji coba voting: **data di blockchain**, **kinerja relayer**, dan **anonimitas suara**. Semua langkah bisa dilakukan sendiri tanpa alat tambahan selain browser.

Letakkan file ini di folder `blockchain/` atau di root proyek.

---

## 1. Verifikasi data di blockchain

### 1.1 Lewat Etherscan

Buka `https://sepolia.etherscan.io/address/ALAMAT_KONTRAK` (ganti dengan alamat kontrak Anda).

- Tab **Transactions** harus memuat: deploy kontrak, `openSession`, satu atau beberapa `castVotes` dari wallet relayer, dan `closeSession` (bila sesi sudah ditutup).
- Tab **Events** harus memuat `SessionOpened`, `CandidatesRegistered`, `VotesCast`, dan `SessionClosed`.

### 1.2 Lewat Remix

Di bagian **Deployed Contracts**, fungsi bertombol **biru** hanya membaca data (tanpa biaya gas):

| Fungsi | Hasil |
|---|---|
| `status` | `0` = belum dimulai, `1` = berlangsung, `2` = ditutup |
| `totalVotes` | Total suara yang sudah dihitung kontrak |
| `getResults` | Nomor paslon dan jumlah suara masing-masing |
| `candidateCount` | Jumlah paslon yang terdaftar |

### 1.3 Pencocokan dengan database

Jalankan di Supabase → **SQL Editor**:

```sql
select count(*) as sudah_memilih from public.tb_pengguna where has_voted;
select status, count(*) from public.tb_antrian_suara group by status;
```

Rumus pemeriksaan:

```
sudah_memilih  =  totalVotes (blockchain)  +  suara berstatus 'menunggu' atau 'diproses'
```

Jika semua suara sudah terkirim, `sudah_memilih` harus **sama persis** dengan `totalVotes`. Aplikasi juga menampilkan peringatan otomatis bila angkanya tidak cocok.

---

## 2. Verifikasi kinerja relayer

| Yang diperiksa | Hasil yang diharapkan |
|---|---|
| Terminal relayer | Ada catatan batch terkirim, tanpa error |
| Antrian suara | Semua suara berstatus `terkirim`; tidak ada yang lama tertahan di `menunggu` atau `diproses` |
| `tx_hash` | Setiap suara terkirim punya `tx_hash`; tempel satu di Etherscan, transaksinya berstatus **Success** |
| Tabel `tb_status_relayer` | `terakhir_aktif` baru, `total_terkirim` bertambah, `error_terakhir` kosong |
| Halaman admin → Sesi Voting | Status relayer tampil aktif |

Untuk melihat status relayer:

```sql
select alamat_relayer, terakhir_aktif, terakhir_kirim, total_terkirim, error_terakhir
from public.tb_status_relayer;
```

### Uji ketahanan (opsional)

1. Pastikan ada suara yang masih menunggu di antrian.
2. Matikan relayer (`Ctrl+C`), lalu nyalakan lagi (`npm start`).
3. Periksa bahwa tidak ada suara yang hilang dan tidak ada yang terhitung dua kali. Kontrak menolak ID suara yang sudah pernah dihitung, sehingga pengiriman ulang aman.

---

## 3. Verifikasi anonimitas suara

### 3.1 Struktur tabel antrian

```sql
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'tb_antrian_suara';
```

Kolom yang ada hanya: ID acak suara, nomor paslon, status, ID batch, waktu batch diproses, dan hash transaksi. **Tidak boleh** ada kolom yang menunjuk ke pemilih (misalnya `user_id`, `nim`) atau waktu pemilih memberi suara.

### 3.2 Isi kontrak

Event `VotesCast` hanya memuat jumlah suara diterima, jumlah duplikat, dan total. Kontrak tidak menyimpan alamat atau identitas pemilih. Pengirim transaksi yang terlihat di Etherscan adalah wallet **relayer**, bukan pemilih.

---

## Batasan yang perlu ditulis di laporan

Anonimitas sistem ini **bergantung pada server** (database dan relayer):

- Blockchain menjamin hasil hitungan tidak bisa diubah, tetapi server melihat pasangan (pemilih, pilihan) sesaat sebelum memisahkannya.
- Pengacakan urutan dan batas minimal batch (`MIN_BATCH`) mengurangi risiko pencocokan lewat waktu, namun **bukan jaminan kriptografis**.
- Hitungan sementara dapat dibaca publik selama sesi berlangsung, karena semua data blockchain bersifat publik.
- Suara yang menunggu di antrian dapat dilihat pemilik database (tanpa identitas) sampai terkirim.

Teknik seperti blind signature atau zero-knowledge proof berada di luar lingkup sistem ini dan dapat dituliskan sebagai **saran pengembangan**. Rincian lengkap ada di bagian "Hal yang perlu diketahui" pada `README.md`.


UJI COBA ISI ADMIN

select p.nim, a.nomor_paslon
from public.tb_pengguna p
join public.tb_antrian_suara a on p.xmin::text = a.xmin::text
where p.has_voted;