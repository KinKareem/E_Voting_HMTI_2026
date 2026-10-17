-- =========================================================
-- SKEMA DATABASE: Sistem E-Voting Ketua HMTI
-- Jalankan SELURUH file ini di Supabase SQL Editor.
--
-- File ini AMAN dijalankan:
--   * di database baru (kosong), maupun
--   * di database lama Anda yang masih memakai tabel `profiles` dan
--     `mahasiswa_whitelist` -> tabel otomatis di-rename, data tetap utuh.
--   * berulang kali (idempoten).
--
-- Penamaan tabel:
--   tb_pengguna    : akun login (mahasiswa & admin), status persetujuan, status sudah voting
--   tb_mahasiswa   : data master mahasiswa hasil upload CSV (menu "Tambah Siswa")
--   tb_kandidat    : data pasangan calon + foto (menu "Kandidat")
--   tb_sesi_voting : status sesi voting (salinan dari blockchain, dipakai server
--                    untuk menolak suara di luar sesi). Hanya satu baris (id = 1).
--   tb_log_admin   : (tidak lagi dipakai landing page; riwayat sesi kini dibaca
--                    langsung dari blockchain). Aman dibiarkan atau dihapus.
--   tb_suara       : suara anonim (TANPA kolom yang menunjuk ke pemilih)
-- =========================================================


-- ---------------------------------------------------------
-- 0. MIGRASI NAMA TABEL LAMA (diabaikan otomatis jika tidak ada)
-- ---------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is not null
     and to_regclass('public.tb_pengguna') is null then
    alter table public.profiles rename to tb_pengguna;
  end if;

  if to_regclass('public.mahasiswa_whitelist') is not null
     and to_regclass('public.tb_mahasiswa') is null then
    alter table public.mahasiswa_whitelist rename to tb_mahasiswa;
  end if;
end $$;

alter index if exists public.profiles_role_status_idx rename to tb_pengguna_role_status_idx;
alter index if exists public.profiles_nim_idx rename to tb_pengguna_nim_idx;


-- ---------------------------------------------------------
-- 1. TABEL
-- ---------------------------------------------------------

-- Akun pengguna, terhubung 1:1 dengan auth.users (Supabase Auth).
create table if not exists public.tb_pengguna (
  id uuid primary key references auth.users (id) on delete cascade,
  nim text not null unique,
  nama_lengkap text not null,
  email text not null,
  role text not null default 'mahasiswa' check (role in ('mahasiswa', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  has_voted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tb_pengguna_role_status_idx on public.tb_pengguna (role, status);
create index if not exists tb_pengguna_nim_idx on public.tb_pengguna (nim);

-- Data master mahasiswa hasil upload CSV oleh admin (menu "Tambah Siswa").
create table if not exists public.tb_mahasiswa (
  id uuid primary key default gen_random_uuid(),
  nim text not null unique,
  nama_lengkap text,
  prodi text,
  angkatan text,
  created_at timestamptz not null default now()
);

-- Pasangan calon Ketua & Wakil Ketua HMTI (menu "Kandidat").
create table if not exists public.tb_kandidat (
  id uuid primary key default gen_random_uuid(),
  nomor_paslon integer not null unique check (nomor_paslon > 0),
  nama_ketua text not null,
  nama_wakil text not null,
  visi text not null,
  misi text not null,
  catatan_tambahan text,
  foto_path text,
  created_at timestamptz not null default now()
);

-- Untuk database lama yang tabel tb_kandidat-nya dibuat sebelum ada kolom foto.
-- foto_path berisi lokasi file di Supabase Storage (bucket "foto-kandidat").
alter table public.tb_kandidat add column if not exists foto_path text;

-- Riwayat aktivitas admin yang ditampilkan di landing page.
-- wallet_address sengaja boleh kosong: kolom ini akan terisi saat integrasi
-- blockchain dibangun (alamat wallet admin yang mengeksekusi smart contract).
create table if not exists public.tb_log_admin (
  id uuid primary key default gen_random_uuid(),
  jenis_aksi text not null check (jenis_aksi in ('buka_sesi', 'tutup_sesi')),
  wallet_address text,
  admin_id uuid references public.tb_pengguna (id) on delete set null,
  waktu timestamptz not null default now()
);

create index if not exists tb_log_admin_waktu_idx on public.tb_log_admin (waktu desc);

-- Suara anonim. SENGAJA tidak ada kolom pengguna maupun timestamp, supaya
-- suara tidak bisa dicocokkan ke pemilih. Tabel ini adalah penampung sementara
-- sampai pengiriman suara dialihkan ke blockchain pada fase berikutnya.
create table if not exists public.tb_suara (
  id uuid primary key default gen_random_uuid(),
  kandidat_id uuid not null references public.tb_kandidat (id)
);

-- Status sesi voting. SUMBER KEBENARAN-nya adalah kontrak di blockchain; tabel ini
-- adalah salinan yang diperbarui halaman admin "Sesi Voting" SETELAH transaksi
-- terkonfirmasi, supaya fungsi fn_kirim_suara bisa menolak suara di luar sesi
-- (database tidak bisa membaca blockchain secara langsung).
-- Landing page membandingkan salinan ini dengan blockchain dan menampilkan
-- peringatan jika keduanya berbeda.
create table if not exists public.tb_sesi_voting (
  id integer primary key default 1 check (id = 1), -- hanya boleh ada satu baris
  status text not null default 'belum_mulai'
    check (status in ('belum_mulai', 'berlangsung', 'selesai')),
  dibuka_pada timestamptz,
  dibuka_oleh text,   -- alamat wallet admin
  dibuka_tx text,     -- hash transaksi
  ditutup_pada timestamptz,
  ditutup_oleh text,
  ditutup_tx text,
  diperbarui_pada timestamptz not null default now()
);

insert into public.tb_sesi_voting (id) values (1) on conflict (id) do nothing;


-- ---------------------------------------------------------
-- 2. FUNGSI BANTU
-- ---------------------------------------------------------

-- Cek apakah user yang sedang login adalah admin. SECURITY DEFINER supaya
-- tidak memicu rekursi RLS saat dipakai di dalam policy tabel tb_pengguna.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tb_pengguna p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Lookup email dari NIM (login & lupa password memakai NIM, sedangkan
-- Supabase Auth berbasis email). Hanya mengembalikan email.
create or replace function public.get_email_by_nim(input_nim text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from public.tb_pengguna where nim = input_nim limit 1;
$$;

revoke all on function public.get_email_by_nim(text) from public;
grant execute on function public.get_email_by_nim(text) to anon, authenticated;

-- Menjaga salinan status sesi agar meniru aturan kontrak blockchain:
--  * status hanya maju: belum_mulai -> berlangsung -> selesai (tidak pernah mundur,
--    sesi yang sudah selesai tidak bisa dibuka lagi)
--  * catatan waktu/wallet/transaksi yang sudah terisi tidak bisa diubah
create or replace function public.fn_jaga_transisi_sesi()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'selesai' and new.status <> 'selesai' then
    raise exception 'Sesi yang sudah selesai tidak dapat dibuka kembali.';
  end if;
  if old.status = 'berlangsung' and new.status = 'belum_mulai' then
    raise exception 'Sesi yang sudah berlangsung tidak dapat dikembalikan ke belum dimulai.';
  end if;

  if (old.dibuka_pada  is not null and new.dibuka_pada  is distinct from old.dibuka_pada)
  or (old.dibuka_oleh  is not null and new.dibuka_oleh  is distinct from old.dibuka_oleh)
  or (old.dibuka_tx    is not null and new.dibuka_tx    is distinct from old.dibuka_tx)
  or (old.ditutup_pada is not null and new.ditutup_pada is distinct from old.ditutup_pada)
  or (old.ditutup_oleh is not null and new.ditutup_oleh is distinct from old.ditutup_oleh)
  or (old.ditutup_tx   is not null and new.ditutup_tx   is distinct from old.ditutup_tx) then
    raise exception 'Catatan pembukaan/penutupan sesi yang sudah tercatat tidak dapat diubah.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_jaga_transisi_sesi on public.tb_sesi_voting;
create trigger trg_jaga_transisi_sesi
  before update on public.tb_sesi_voting
  for each row execute function public.fn_jaga_transisi_sesi();

-- Mengirim suara. Dalam SATU transaksi: tandai pemilih sudah memilih
-- (one person, one vote) dan simpan suara anonim (hanya id kandidat).
-- Pemilih tidak bisa menulis ke tb_suara / mengubah has_voted secara langsung;
-- satu-satunya jalur adalah fungsi ini.
create or replace function public.fn_kirim_suara(p_kandidat_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pengguna public.tb_pengguna%rowtype;
begin
  -- Kunci baris pemilih supaya klik ganda / request paralel tidak lolos dua kali.
  select * into v_pengguna
  from public.tb_pengguna
  where id = auth.uid()
  for update;

  if not found or v_pengguna.role <> 'mahasiswa' or v_pengguna.status <> 'approved' then
    raise exception 'Akun Anda tidak berhak memberikan suara.';
  end if;

  if v_pengguna.has_voted then
    raise exception 'Anda sudah menggunakan hak suara.';
  end if;

  if not exists (select 1 from public.tb_sesi_voting where id = 1 and status = 'berlangsung') then
    raise exception 'Sesi voting sedang tidak berlangsung.';
  end if;

  if not exists (select 1 from public.tb_kandidat where id = p_kandidat_id) then
    raise exception 'Kandidat tidak ditemukan.';
  end if;

  update public.tb_pengguna set has_voted = true where id = v_pengguna.id;
  insert into public.tb_suara (kandidat_id) values (p_kandidat_id);

  return 'ok';
end;
$$;

revoke all on function public.fn_kirim_suara(uuid) from public;
grant execute on function public.fn_kirim_suara(uuid) to authenticated;


-- ---------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------
alter table public.tb_pengguna enable row level security;
alter table public.tb_mahasiswa enable row level security;
alter table public.tb_kandidat enable row level security;
alter table public.tb_log_admin enable row level security;
alter table public.tb_suara enable row level security;  -- tanpa policy: tidak bisa diakses langsung
alter table public.tb_sesi_voting enable row level security;

-- Bersihkan policy lama (nama lama maupun nama baru) agar skrip bisa diulang.
drop policy if exists "profiles: user can read own row" on public.tb_pengguna;
drop policy if exists "profiles: user can insert own row" on public.tb_pengguna;
drop policy if exists "profiles: admin can read all" on public.tb_pengguna;
drop policy if exists "profiles: admin can update all" on public.tb_pengguna;
drop policy if exists "whitelist: admin can select" on public.tb_mahasiswa;
drop policy if exists "whitelist: admin can insert" on public.tb_mahasiswa;

drop policy if exists "tb_pengguna: baca baris sendiri" on public.tb_pengguna;
drop policy if exists "tb_pengguna: daftar akun sendiri" on public.tb_pengguna;
drop policy if exists "tb_pengguna: admin baca semua" on public.tb_pengguna;
drop policy if exists "tb_pengguna: admin ubah semua" on public.tb_pengguna;
drop policy if exists "tb_mahasiswa: admin baca" on public.tb_mahasiswa;
drop policy if exists "tb_mahasiswa: admin tambah" on public.tb_mahasiswa;
drop policy if exists "tb_mahasiswa: admin ubah" on public.tb_mahasiswa;
drop policy if exists "tb_kandidat: user login baca" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin tambah" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin ubah" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin hapus" on public.tb_kandidat;
drop policy if exists "tb_sesi_voting: user login baca" on public.tb_sesi_voting;
drop policy if exists "tb_sesi_voting: admin ubah" on public.tb_sesi_voting;
drop policy if exists "tb_log_admin: user login baca" on public.tb_log_admin;
drop policy if exists "tb_log_admin: admin tambah" on public.tb_log_admin;

-- tb_pengguna
create policy "tb_pengguna: baca baris sendiri"
  on public.tb_pengguna for select
  using (auth.uid() = id);

-- Saat registrasi, user hanya boleh membuat baris dirinya sendiri dengan nilai
-- awal yang wajar: mahasiswa harus 'pending', dan tidak ada yang boleh
-- mendaftar dengan has_voted = true.
create policy "tb_pengguna: daftar akun sendiri"
  on public.tb_pengguna for insert
  with check (
    auth.uid() = id
    and has_voted = false
    and (
      (role = 'mahasiswa' and status = 'pending')
      or (role = 'admin' and status = 'approved')
    )
  );

create policy "tb_pengguna: admin baca semua"
  on public.tb_pengguna for select
  using ( public.is_admin() );

create policy "tb_pengguna: admin ubah semua"
  on public.tb_pengguna for update
  using ( public.is_admin() );

-- tb_mahasiswa (upload CSV memakai upsert, jadi butuh insert + update)
create policy "tb_mahasiswa: admin baca"
  on public.tb_mahasiswa for select
  using ( public.is_admin() );

create policy "tb_mahasiswa: admin tambah"
  on public.tb_mahasiswa for insert
  with check ( public.is_admin() );

create policy "tb_mahasiswa: admin ubah"
  on public.tb_mahasiswa for update
  using ( public.is_admin() );

-- tb_kandidat: semua user yang login boleh melihat, hanya admin yang menambah.
create policy "tb_kandidat: user login baca"
  on public.tb_kandidat for select
  to authenticated
  using ( true );

create policy "tb_kandidat: admin tambah"
  on public.tb_kandidat for insert
  with check ( public.is_admin() );

create policy "tb_kandidat: admin ubah"
  on public.tb_kandidat for update
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- Kandidat yang sudah menerima suara tidak bisa dihapus: tb_suara.kandidat_id
-- memakai foreign key tanpa cascade, jadi database menolaknya otomatis.
create policy "tb_kandidat: admin hapus"
  on public.tb_kandidat for delete
  using ( public.is_admin() );

-- tb_sesi_voting: semua user yang login boleh melihat, hanya admin yang boleh mengubah.
-- Tidak ada policy insert/delete: baris tunggalnya dibuat oleh skrip ini.
create policy "tb_sesi_voting: user login baca"
  on public.tb_sesi_voting for select
  to authenticated
  using ( true );

create policy "tb_sesi_voting: admin ubah"
  on public.tb_sesi_voting for update
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- tb_log_admin: semua user yang login boleh melihat, hanya admin yang menambah.
create policy "tb_log_admin: user login baca"
  on public.tb_log_admin for select
  to authenticated
  using ( true );

create policy "tb_log_admin: admin tambah"
  on public.tb_log_admin for insert
  with check ( public.is_admin() );


-- ---------------------------------------------------------
-- 4. STORAGE: FOTO KANDIDAT
-- ---------------------------------------------------------
-- Bucket publik (foto kandidat memang ditampilkan ke semua pemilih), dibatasi
-- 2 MB per file dan hanya JPG/PNG/WEBP. Hanya admin yang boleh upload/hapus.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'foto-kandidat', 'foto-kandidat', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto_kandidat: publik baca" on storage.objects;
drop policy if exists "foto_kandidat: admin upload" on storage.objects;
drop policy if exists "foto_kandidat: admin hapus" on storage.objects;

-- Policy baca juga dibutuhkan agar admin bisa menghapus file (DELETE ... WHERE
-- ikut memeriksa policy SELECT).
create policy "foto_kandidat: publik baca"
  on storage.objects for select
  using ( bucket_id = 'foto-kandidat' );

create policy "foto_kandidat: admin upload"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'foto-kandidat' and public.is_admin() );

create policy "foto_kandidat: admin hapus"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'foto-kandidat' and public.is_admin() );