# Panduan Deploy Kontrak VotingSession

Kontrak ini mencatat **kapan sesi voting dibuka dan ditutup** serta wallet admin yang melakukannya.
Panduan ini memakai jaringan uji **Sepolia** (gratis, tanpa uang sungguhan) dan **Remix** (editor
Solidity di browser), jadi tidak ada yang perlu diinstal selain MetaMask.

## Yang perlu dipahami dulu

- **Wallet yang mendeploy = pemilik kontrak, selamanya.** Hanya wallet itu yang bisa membuka dan
  menutup sesi. Pemilik tidak bisa diganti.
- Jika wallet/seed phrase pemilik hilang, sesi **tidak bisa ditutup**. Simpan seed phrase di tempat aman
  dan jangan pernah membagikannya ke siapa pun (termasuk lewat chat atau screenshot).
- Sesi yang sudah ditutup **tidak bisa dibuka lagi**. Untuk pemilihan baru, deploy kontrak baru
  (lihat bagian "Pemilihan baru" di bawah).
- Biaya transaksi (gas) dibayar dari wallet admin. Di Sepolia biayanya memakai koin uji gratis.

## 1. Siapkan MetaMask dan koin uji

1. Pasang ekstensi **MetaMask** (metamask.io/download) lalu buat wallet. Catat seed phrase dengan aman.
2. Aktifkan jaringan uji: **Settings → Advanced → Show test networks**, lalu pilih jaringan **Sepolia**
   di pojok kiri atas MetaMask.
3. Minta koin uji gratis: cari **"Sepolia faucet"** di internet (beberapa penyedia, misalnya Alchemy
   atau Google Cloud, menyediakannya), tempel alamat wallet Anda, lalu tunggu saldo SepoliaETH masuk.
   Cukup sedikit; deploy dan dua transaksi (buka + tutup) memakai gas yang sangat kecil.

## 2. Deploy kontrak lewat Remix

1. Buka **remix.ethereum.org**.
2. Di panel File, buat file baru bernama `VotingSession.sol`, lalu tempel seluruh isi file
   `blockchain/VotingSession.sol` dari project ini.
3. Buka tab **Solidity Compiler**, pilih versi compiler **0.8.20 atau lebih baru**, klik **Compile**.
   Pastikan tidak ada error (tanda centang hijau).
4. Buka tab **Deploy & Run Transactions**:
   - **Environment**: pilih **Injected Provider - MetaMask**. MetaMask akan meminta izin; setujui.
   - Pastikan jaringan yang tampil **Sepolia** dan akun yang dipilih adalah wallet admin Anda.
   - **Contract**: pilih `VotingSession`.
   - Klik **Deploy**, lalu **Confirm** di jendela MetaMask.
5. Setelah selesai, kontrak muncul di bagian **Deployed Contracts**. Klik ikon salin di sebelah
   namanya untuk menyalin **alamat kontrak** (diawali `0x`).

## 3. Hubungkan aplikasi ke kontrak

1. Buka `js/Blockchainconfig.js`, isi alamat kontrak:

   ```js
   CONTRACT_ADDRESS: "0xALAMAT_KONTRAK_ANDA",
   ```

   Pengaturan lain (`CHAIN_ID`, `RPC_URL`, dll.) sudah diisi untuk Sepolia.
2. Jalankan **seluruh isi `supabase/schema.sql`** terbaru di SQL Editor Supabase (menambah tabel
   `tb_sesi_voting` dan aturan voting hanya saat sesi berlangsung).
3. Muat ulang aplikasi.

## 4. Coba

1. Login sebagai admin → menu **Sesi Voting**. Status harus **Belum dimulai**.
2. Klik **Hubungkan MetaMask** (pakai wallet yang sama dengan saat deploy). Chip hijau
   "Pemilik kontrak" harus muncul.
3. Klik **Mulai Sesi Voting** → baca popup → konfirmasi → setujui di MetaMask. Tunggu tiga langkah
   progres selesai.
4. Buka halaman mahasiswa: tombol **Pilih Paslon** aktif dan riwayat "Sesi voting telah dibuka"
   muncul (dibaca langsung dari blockchain).

## Pemecahan masalah

| Pesan / gejala | Penyebab & solusi |
|---|---|
| "Alamat kontrak belum diisi" | `CONTRACT_ADDRESS` di `js/Blockchainconfig.js` masih kosong. |
| "Kontrak tidak ditemukan di alamat tersebut…" | Alamat salah, atau kontrak dideploy di jaringan lain dari `CHAIN_ID` di config. |
| "MetaMask tidak terdeteksi" | Ekstensi MetaMask belum terpasang/aktif di browser itu. |
| Chip "Bukan pemilik kontrak" | Akun MetaMask yang aktif bukan akun yang mendeploy. Ganti akun di MetaMask. |
| Chip "Jaringan salah" | Klik tombol **Ganti ke Sepolia** di halaman Sesi Voting. |
| "Saldo wallet tidak cukup…" | Minta koin uji lewat faucet Sepolia. |
| Riwayat/status sesi sering gagal dimuat | RPC publik sedang lambat. Ganti `RPC_URL` dengan alamat Sepolia dari Alchemy/Infura (gratis, perlu daftar). |
| "Belum sinkron" di baris Salinan database | Klik **Muat ulang**. Salinan database mengikuti blockchain secara otomatis. |

## Pemilihan baru (kontrak baru)

1. Deploy kontrak baru (bagian 2) dan ganti `CONTRACT_ADDRESS`.
2. Kembalikan status sesi di database. Database sengaja menolak status mundur, jadi matikan penjaganya
   sementara di SQL Editor:

   ```sql
   alter table public.tb_sesi_voting disable trigger trg_jaga_transisi_sesi;
   update public.tb_sesi_voting
     set status = 'belum_mulai',
         dibuka_pada = null, dibuka_oleh = null, dibuka_tx = null,
         ditutup_pada = null, ditutup_oleh = null, ditutup_tx = null,
         diperbarui_pada = now()
     where id = 1;
   alter table public.tb_sesi_voting enable trigger trg_jaga_transisi_sesi;
   ```
3. Data suara dan status `has_voted` pemilihan sebelumnya perlu dibersihkan terpisah.

## Menjalankan pengujian kontrak

Pengujian berjalan di blockchain lokal (tanpa internet dan tanpa biaya):

```bash
cd blockchain
npm install
npm test
```

Pengujian mengompilasi kontrak, mendeploy-nya, lalu memeriksa kontrol akses, urutan status,
penutupan permanen, event, dan kecocokan ABI dengan `js/Blockchainconfig.js`. Hasilnya bisa
dilampirkan sebagai bukti pengujian di laporan tugas akhir.

## Yang belum termasuk

Kontrak ini baru mencatat **sesi** (buka/tutup). Pengiriman suara pemilih ke blockchain belum
dibuat; saat ini suara masih disimpan di database lewat fungsi `fn_kirim_suara`.
