# Skenario Pengujian E-Voting HMTI

Daftar kasus uji untuk fungsi dan keamanan aplikasi. Disusun dari kode di `schema.sql`, `VotingSession.sol`, `Auth.js`, dan `relayer.js`. **Hasil yang diharapkan adalah dugaan dari kode, belum dijalankan**; isi kolom "Hasil sebenarnya" saat menguji, lalu bandingkan.

Tanda: **[RISIKO]** = dari kode terlihat berpotensi gagal/berbahaya, prioritaskan.

Persiapan: 1 akun admin, 1 wallet pemilik (MetaMask), 1 wallet lain (bukan pemilik), 3+ akun mahasiswa (approved), 1 mahasiswa pending, minimal 2 kandidat, relayer berjalan.

---

## A. Registrasi dan login

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| A1 | Daftar mahasiswa NIM tidak ada di data | Daftar dengan NIM yang tidak ada di `tb_mahasiswa` | Ditolak |
| A2 | Daftar mahasiswa NIM valid | Daftar dengan NIM dari CSV | Berhasil, status `pending` |
| A3 | Daftar dua kali dengan NIM sama | Ulangi A2 | Ditolak ("sudah terdaftar") |
| A4 | Login mahasiswa pending | Login sebelum disetujui admin | "Masih menunggu konfirmasi admin" |
| A5 | Login mahasiswa ditolak | Admin tolak, lalu login | "Registrasi ditolak" |
| A6 | Password salah | Login dengan password salah | "NIM atau password salah" |
| A7 | NIM tidak terdaftar | Login NIM acak | "NIM tidak ditemukan" |
| A8 | Mahasiswa login di halaman admin | Login `admin.html` dengan akun mahasiswa | "Akun ini bukan akun admin" |
| A9 | Admin login di halaman mahasiswa | Login `index.html` dengan akun admin | Ditolak, diarahkan ke login admin |
| A10 | Password kurang dari 6 karakter | Daftar dengan 5 karakter | Ditolak |
| A11 | Lupa password | Pakai menu lupa password | Tautan reset terkirim ke email terdaftar |
| A12 | **[RISIKO]** Daftar admin tanpa kode | Di `admin.html` tab Daftar, buat akun admin baru dengan data bebas | Dari kode: **berhasil** dan langsung berstatus `approved`, siapa pun bisa jadi admin. Catat sebagai temuan keamanan |

## B. Hak akses dan keamanan halaman

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| B1 | Buka halaman admin tanpa login | Buka `admin/konfirmasi.html` langsung | Dialihkan ke login admin |
| B2 | Mahasiswa buka halaman admin | Login mahasiswa, ketik URL `admin/kandidat.html` | Dikeluarkan dan dialihkan |
| B3 | Buka landing tanpa login | Buka `landing.html` | Dialihkan ke login |
| B4 | Sesi kedaluwarsa | Hapus sesi login lalu muat ulang | Diminta login ulang |
| B5 | Mahasiswa ubah data lewat konsol | Di Console jalankan `sb.from('tb_pengguna').update({has_voted:false})` | Ditolak oleh RLS |
| B6 | Mahasiswa tulis langsung ke antrian | `sb.from('tb_antrian_suara').insert({nomor_paslon:1})` | Ditolak |
| B7 | Mahasiswa ubah status sesi | `sb.from('tb_sesi_voting').update({status:'berlangsung'})` | Ditolak (hanya admin) |
| B8 | Mahasiswa ubah kandidat | Insert/update/delete `tb_kandidat` dari konsol | Ditolak |
| B9 | Mahasiswa lihat data pemilih lain | `sb.from('tb_pengguna').select('*')` | Hanya barisnya sendiri |
| B10 | Mahasiswa daftar dengan `has_voted=true` atau `role=admin` lewat API | Insert langsung ke `tb_pengguna` | `has_voted=true` ditolak. **[RISIKO]** `role=admin,status=approved` diizinkan oleh policy (lihat A12) |
| B11 | **[RISIKO]** Admin hasil A12 ubah status sesi di database | Login sebagai admin baru, ubah `tb_sesi_voting` | Dari policy: diizinkan. Blockchain tetap tidak berubah; landing seharusnya menampilkan peringatan beda status |

## C. Smart contract dan wallet

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| C1 | Buka sesi dengan wallet bukan pemilik | Hubungkan MetaMask dengan wallet lain, Mulai Sesi | Chip "Bukan pemilik kontrak"; transaksi ditolak (`NotOwner`) |
| C2 | Tutup sesi dengan wallet bukan pemilik | Sama, Tutup Sesi | Ditolak |
| C3 | Jaringan salah | Ganti MetaMask ke jaringan lain | Chip "Jaringan salah", tombol ganti ke Sepolia |
| C4 | Saldo gas tidak cukup | Pakai wallet pemilik saldo 0 | Pesan "Saldo wallet tidak cukup" |
| C5 | Buka sesi dua kali | Setelah dibuka, panggil `openSession` lagi di Remix | Ditolak (`InvalidState`) |
| C6 | Buka sesi setelah ditutup | Setelah ditutup, coba Mulai lagi | Ditolak, harus deploy baru |
| C7 | Kirim suara dari wallet non-relayer | Di Remix, `castVotes` dari akun pemilik atau akun lain | Ditolak (`NotRelayer`) |
| C8 | Kirim suara ke nomor paslon tidak terdaftar | `castVotes` dari relayer dengan nomor 99 | Ditolak (`InvalidCandidate`) |
| C9 | ID suara ganda | Kirim ID yang sama dua kali | Kedua kali tidak menambah hitungan (duplikat dilewati) |
| C10 | Kirim suara saat sesi belum dibuka / sudah ditutup | `castVotes` pada status 0 atau 2 | Ditolak |
| C11 | Ganti relayer oleh bukan pemilik | `setRelayer` dari akun lain | Ditolak (`NotOwner`) |
| C12 | Ganti relayer oleh pemilik | `setRelayer` ke alamat baru, relayer lama kirim suara | Relayer lama ditolak, yang baru diterima |
| C13 | Alamat kontrak salah | Isi `CONTRACT_ADDRESS` asal | Pesan "Kontrak tidak ditemukan"; relayer "Gagal membaca kontrak" |
| C14 | MetaMask tidak terpasang | Buka halaman Sesi Voting di browser tanpa MetaMask | Pesan "MetaMask tidak terdeteksi" |
| C15 | Tolak transaksi di MetaMask | Klik Reject saat buka sesi | Sesi tidak berubah, ada pesan batal |

## D. Proses voting

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| D1 | Memilih saat sesi belum dibuka | Login mahasiswa sebelum Mulai Sesi | Tombol Pilih Paslon nonaktif |
| D2 | Memilih normal | Sesi berlangsung, pilih paslon, konfirmasi | Berhasil, `has_voted = true` |
| D3 | **Akun yang sama memilih lagi** | Login ulang, coba pilih lagi | "Anda sudah menggunakan hak suara" |
| D4 | Klik ganda cepat | Klik "Ya, Kirim Suara" berkali-kali | Hanya 1 suara masuk |
| D5 | Dua tab, satu akun | Buka dua tab, pilih bersamaan | Hanya satu yang berhasil |
| D6 | Pilih kandidat fiktif lewat API | `sb.rpc('fn_kirim_suara',{p_kandidat_id:'uuid-acak'})` | "Kandidat tidak ditemukan" |
| D7 | Panggil fungsi suara tanpa login | RPC tanpa sesi | Ditolak |
| D8 | Admin mencoba memilih | Login admin, panggil `fn_kirim_suara` | "Tidak berhak memberikan suara" |
| D9 | Mahasiswa pending mencoba memilih | Akun pending panggil RPC | Ditolak |
| D10 | Memilih saat sesi "menutup" | Admin mulai menutup, mahasiswa memilih | "Sesi voting sedang tidak berlangsung" |
| D11 | Memilih setelah ditutup | Sesi selesai, coba pilih | Ditolak |
| D12 | Tutup browser saat konfirmasi | Tutup tab tepat setelah klik kirim, login lagi | Salah satu: sudah memilih, atau belum sama sekali; tidak boleh setengah-setengah |

## E. Relayer

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| E1 | Suara terkirim normal | Beri suara, tunggu interval | Antrian `terkirim`, `tx_hash` terisi, `totalVotes` bertambah |
| E2 | Di bawah `MIN_BATCH` | Atur `MIN_BATCH=5`, beri 2 suara | Suara menunggu sampai cukup 5 (atau sesi menutup) |
| E3 | Relayer dimatikan saat ada antrian | Ctrl+C, lalu `npm start` | Tidak ada suara hilang atau ganda |
| E4 | Relayer mati lalu sesi ditutup | Matikan relayer, klik Tutup | Penutupan menunggu; bisa dibatalkan admin |
| E5 | Saldo gas relayer habis | Kosongkan saldo | `error_terakhir` terisi; suara tertahan, tidak hilang |
| E6 | Private key relayer salah | Ubah di `.env` | Gagal mulai dengan pesan jelas |
| E7 | `.env` belum diisi | Biarkan placeholder | "Variabel di file .env belum diisi" |
| E8 | Batch lebih dari `MAKS_BATCH` | Banyak suara sekaligus | Dikirim bertahap, maksimal 50 per transaksi |
| E9 | RPC mati | Ubah `RPC_URL` ke alamat salah | Error terbaca, relayer terus mencoba |
| E10 | Dua relayer jalan bersamaan | Jalankan dua terminal | Tidak ada hitungan ganda (ID suara dicek kontrak) |

## F. Konsistensi, hasil, dan anonimitas

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| F1 | Total cocok | Setelah semua `terkirim` | `sudah_memilih` = `totalVotes` |
| F2 | Hasil tersembunyi saat sesi berjalan | Buka landing saat sesi aktif | Hasil per paslon tidak ditampilkan |
| F3 | Hasil akhir | Tutup sesi | Hasil tampil di admin dan landing, sama dengan `getResults` |
| F4 | Ketidakcocokan terdeteksi | Ubah manual salah satu `has_voted` di database | Aplikasi menampilkan peringatan |
| F5 | Status database beda dari blockchain | Ubah `tb_sesi_voting` manual | Landing menampilkan peringatan |
| F6 | Status mundur ditolak | `update tb_sesi_voting set status='belum_mulai'` | Ditolak oleh trigger |
| F7 | Catatan buka/tutup tidak bisa diubah | Ubah `dibuka_tx` setelah terisi | Ditolak |
| F8 | Antrian tanpa identitas | Cek kolom `tb_antrian_suara` | Tidak ada kolom pemilih atau waktu memilih |
| F9 | Blockchain tanpa identitas | Lihat event di Etherscan | Hanya jumlah dan ID acak; pengirim adalah relayer |
| F10 | Urutan suara acak | Beri suara berurutan A, B, C, lalu lihat urutan di antrian/batch | Urutan terkirim tidak sama dengan urutan memilih |

## G. Data kandidat dan admin

| ID | Skenario | Langkah | Hasil diharapkan |
|---|---|---|---|
| G1 | Tambah kandidat valid | Isi form + foto JPG/PNG/WEBP < 2 MB | Tersimpan |
| G2 | Foto lebih dari 2 MB | Unggah foto besar | Ditolak |
| G3 | Foto format salah | Unggah PDF atau GIF | Ditolak |
| G4 | Nomor paslon ganda | Dua kandidat nomor sama | Ditolak |
| G5 | Edit/hapus kandidat saat sesi berjalan | Coba setelah Mulai Sesi | "Data kandidat dikunci" |
| G6 | Upload CSV mahasiswa benar | Unggah CSV sesuai format | Data masuk |
| G7 | Upload CSV rusak | Kolom kurang, baris kosong, NIM ganda | Ditangani tanpa merusak data |
| G8 | Setujui dan tolak pendaftaran | Menu Konfirmasi | Status berubah dan akun bisa/tidak bisa login |
| G9 | Ekspor CSV SKP | Menu List Voting | File berisi status memilih, tanpa pilihan |
| G10 | Buka sesi tanpa kandidat | Hapus semua kandidat, Mulai Sesi | Ditolak atau peringatan (kontrak menolak daftar kosong) |

---

## Catatan hasil uji

Salin tabel ini ke laporan dan tambahkan kolom **Hasil sebenarnya**, **Lulus/Gagal**, dan **Bukti** (tangkapan layar atau hash transaksi Etherscan). Untuk kasus yang gagal atau bertanda **[RISIKO]**, tulis sebagai temuan beserta saran perbaikan.
