-- Migrasi: hapus kolom Wakil Ketua dari tb_kandidat.
-- Jalankan sekali di Supabase SQL Editor pada database yang sudah berjalan.
-- Aman dijalankan ulang (idempotent). Data nama_wakil yang ada akan hilang permanen.
alter table public.tb_kandidat
drop column if exists nama_wakil;
