-- =========================================================
-- RESET UNTUK PEMILIHAN BARU (cara manual)
-- CATATAN: sekarang cukup memakai menu Sesi Voting > Kontrak Pemilihan, yang mengganti alamat
-- kontrak DAN mereset data ini dalam satu langkah. Skrip ini tetap ada sebagai cadangan.
-- Jalankan di Supabase -> SQL Editor, SETELAH mendeploy kontrak baru
-- dan mengganti CONTRACT_ADDRESS (js/Blockchainconfig.js + relayer/.env).
--
-- Yang DIHAPUS : antrian suara, status "sudah memilih".
-- Yang DIPERTAHANKAN: akun & data mahasiswa (tb_pengguna), data kandidat.
-- PERHATIAN: tidak bisa dibatalkan. Suara lama di database hilang
-- (hasil di blockchain kontrak lama tetap ada).
-- =========================================================
begin;
-- 1. Kembalikan status sesi ke "belum_mulai".
--    Penjaga transisi dimatikan sementara karena database sengaja menolak status mundur.
alter table public.tb_sesi_voting disable trigger trg_jaga_transisi_sesi;
update public.tb_sesi_voting
set status = 'belum_mulai',
   dibuka_pada = null,
   dibuka_oleh = null,
   dibuka_tx = null,
   ditutup_pada = null,
   ditutup_oleh = null,
   ditutup_tx = null,
   diperbarui_pada = now()
where id = 1;
alter table public.tb_sesi_voting enable trigger trg_jaga_transisi_sesi;
-- 2. Kosongkan antrian suara yang lama.
delete from public.tb_antrian_suara;
-- 3. (tb_suara, tabel versi lama sebelum ada blockchain, sudah dihapus dari skema -- tidak ada lagi yang perlu dikosongkan di sini.)
-- 4. Semua pemilih boleh memilih lagi.
update public.tb_pengguna
set has_voted = false
where has_voted = true;
-- 5. Reset catatan relayer (hitungan terkirim & error terakhir).
update public.tb_status_relayer
set total_terkirim = 0,
   terakhir_kirim = null,
   error_terakhir = null
where id = 1;
commit;
-- Pemeriksaan hasil (harus: belum_mulai | 0 | 0):
select (
      select status
      from public.tb_sesi_voting
      where id = 1
   ) as status_sesi,
   (
      select count(*)
      from public.tb_antrian_suara
   ) as antrian,
   (
      select count(*)
      from public.tb_pengguna
      where has_voted
   ) as sudah_memilih;