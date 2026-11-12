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
--   tb_kandidat    : data pasangan calon + foto (menu "Kandidat")
--   tb_sesi_voting : status sesi voting (salinan dari blockchain, dipakai server
--                    untuk menolak suara di luar sesi). Hanya satu baris (id = 1).
--   tb_log_admin   : (tidak lagi dipakai landing page; riwayat sesi kini dibaca
--                    langsung dari blockchain). Aman dibiarkan atau dihapus.
--   tb_antrian_suara : antrian suara anonim yang menunggu dikirim ke blockchain oleh
--                    relayer (TANPA kolom yang menunjuk ke pemilih, TANPA waktu memilih)
--   tb_status_relayer: detak jantung relayer (aktif/tidak, terakhir kirim, error)
-- =========================================================
-- ---------------------------------------------------------
-- 0. MIGRASI NAMA TABEL LAMA (diabaikan otomatis jika tidak ada)
-- ---------------------------------------------------------
do $$ begin if to_regclass('public.profiles') is not null
and to_regclass('public.tb_pengguna') is null then
alter table public.profiles
  rename to tb_pengguna;
end if;
end $$;
alter index if exists public.profiles_role_status_idx
rename to tb_pengguna_role_status_idx;
alter index if exists public.profiles_nim_idx
rename to tb_pengguna_nim_idx;
-- ---------------------------------------------------------
-- 1. TABEL
-- ---------------------------------------------------------
-- Pengguna (mahasiswa & admin). id = id akun di auth.users (Supabase Auth).
create table if not exists public.tb_pengguna (
  id uuid primary key default gen_random_uuid(),
  nim text not null unique,
  nama_lengkap text not null,
  email text,
  prodi text,
  angkatan text,
  role text not null default 'mahasiswa' check (role in ('mahasiswa', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  has_voted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists tb_pengguna_role_status_idx on public.tb_pengguna (role, status);
create index if not exists tb_pengguna_nim_idx on public.tb_pengguna (nim);
-- ---------------------------------------------------------
-- Data mahasiswa disimpan langsung di tb_pengguna (tabel tb_mahasiswa sudah tidak dipakai).
-- Baris tanpa akun login berstatus 'pending' dengan email kosong, lalu "diambil alih"
-- saat mahasiswa itu mendaftar (fn_daftar_mahasiswa).
-- Blok ini aman dijalankan berulang.
-- ---------------------------------------------------------
-- id tidak lagi harus sama dengan id di auth.users (baris belum punya akun login).
do $$
declare r record;
begin for r in
select conname
from pg_constraint
where conrelid = 'public.tb_pengguna'::regclass
  and contype = 'f'
  and confrelid = 'auth.users'::regclass loop execute format(
    'alter table public.tb_pengguna drop constraint %I',
    r.conname
  );
end loop;
end $$;
alter table public.tb_pengguna
alter column id
set default gen_random_uuid();
alter table public.tb_pengguna
alter column email drop not null;
alter table public.tb_pengguna
add column if not exists prodi text;
alter table public.tb_pengguna
add column if not exists angkatan text;
-- Pengganti "on delete cascade": hapus baris tb_pengguna jika akun login-nya dihapus.
create or replace function public.fn_hapus_pengguna_auth() returns trigger language plpgsql security definer
set search_path = public as $$ begin
delete from public.tb_pengguna
where id = old.id;
return old;
end;
$$;
drop trigger if exists trg_hapus_pengguna_auth on auth.users;
create trigger trg_hapus_pengguna_auth
after delete on auth.users for each row execute function public.fn_hapus_pengguna_auth();
-- Pindahkan data tb_mahasiswa lama (jika masih ada) ke tb_pengguna, lalu hapus tabelnya.
do $$
declare t text;
begin foreach t in array array ['tb_mahasiswa', 'mahasiswa_whitelist'] loop if to_regclass('public.' || t) is not null then execute format(
  $q$
  insert into public.tb_pengguna (
      nim,
      nama_lengkap,
      prodi,
      angkatan,
      role,
      status,
      has_voted
    )
  select m.nim,
    coalesce(nullif(m.nama_lengkap, ''), m.nim),
    m.prodi,
    m.angkatan,
    'mahasiswa',
    'pending',
    false
  from public.%I m
  where not exists (
      select 1
      from public.tb_pengguna p
      where p.nim = m.nim
    ) $q$,
    t
);
execute format('drop table public.%I', t);
end if;
end loop;
end $$;
-- Calon Ketua HMTI (menu "Kandidat").
create table if not exists public.tb_kandidat (
  id uuid primary key default gen_random_uuid(),
  nomor_paslon integer not null unique check (nomor_paslon > 0),
  nama_ketua text not null,
  visi text not null,
  misi text not null,
  catatan_tambahan text,
  foto_path text,
  created_at timestamptz not null default now()
);
-- Untuk database lama yang tabel tb_kandidat-nya dibuat sebelum ada kolom foto.
-- foto_path berisi lokasi file di Supabase Storage (bucket "foto-kandidat").
alter table public.tb_kandidat
add column if not exists foto_path text;
-- Untuk database lama: kolom Wakil Ketua sudah tidak dipakai lagi.
alter table public.tb_kandidat drop column if exists nama_wakil;
-- Riwayat aktivitas admin yang ditampilkan di landing page.
-- wallet_address sengaja boleh kosong: kolom ini akan terisi saat integrasi
-- blockchain dibangun (alamat wallet admin yang mengeksekusi smart contract).
create table if not exists public.tb_log_admin (
  id uuid primary key default gen_random_uuid(),
  jenis_aksi text not null check (jenis_aksi in ('buka_sesi', 'tutup_sesi')),
  wallet_address text,
  admin_id uuid references public.tb_pengguna (id) on delete
  set null,
    waktu timestamptz not null default now()
);
create index if not exists tb_log_admin_waktu_idx on public.tb_log_admin (waktu desc);
-- Status sesi voting. SUMBER KEBENARAN-nya adalah kontrak di blockchain; tabel ini
-- adalah salinan yang diperbarui halaman admin "Sesi Voting" SETELAH transaksi
-- terkonfirmasi, supaya fungsi fn_kirim_suara bisa menolak suara di luar sesi
-- (database tidak bisa membaca blockchain secara langsung).
-- Landing page membandingkan salinan ini dengan blockchain dan menampilkan
-- peringatan jika keduanya berbeda.
create table if not exists public.tb_sesi_voting (
  id integer primary key default 1 check (id = 1),
  -- hanya boleh ada satu baris
  -- 'menutup' = tahap peralihan di database: penerimaan suara baru dihentikan sambil
  -- menunggu antrian suara terkirim semua ke blockchain, sebelum sesi ditutup di chain.
  status text not null default 'belum_mulai' check (
    status in (
      'belum_mulai',
      'berlangsung',
      'menutup',
      'selesai'
    )
  ),
  dibuka_pada timestamptz,
  dibuka_oleh text,
  -- alamat wallet admin
  dibuka_tx text,
  -- hash transaksi
  ditutup_pada timestamptz,
  ditutup_oleh text,
  ditutup_tx text,
  diperbarui_pada timestamptz not null default now()
);
insert into public.tb_sesi_voting (id)
values (1) on conflict (id) do nothing;
-- Untuk database lama: perluas pilihan status dengan 'menutup'.
alter table public.tb_sesi_voting drop constraint if exists tb_sesi_voting_status_check;
alter table public.tb_sesi_voting
add constraint tb_sesi_voting_status_check check (
    status in (
      'belum_mulai',
      'berlangsung',
      'menutup',
      'selesai'
    )
  );
-- Antrian suara yang menunggu dikirim relayer ke blockchain.
-- SENGAJA tidak ada kolom pemilih dan tidak ada waktu pembuatan: urutan masuk dan waktu
-- memilih tidak boleh bisa dicocokkan dengan urutan di blockchain. Kolom id adalah ID
-- ACAK suara; kontrak memakainya untuk menolak penghitungan ganda.
create table if not exists public.tb_antrian_suara (
  id uuid primary key default gen_random_uuid(),
  nomor_paslon integer not null,
  status text not null default 'menunggu' check (status in ('menunggu', 'diproses', 'terkirim')),
  batch_id uuid,
  diproses_pada timestamptz,
  -- waktu batch diambil relayer (waktu batch, bukan waktu memilih)
  tx_hash text
);
create index if not exists tb_antrian_suara_status_idx on public.tb_antrian_suara (status);
-- Satu baris: detak jantung relayer, ditulis oleh relayer, dibaca halaman admin.
create table if not exists public.tb_status_relayer (
  id integer primary key default 1 check (id = 1),
  alamat_relayer text,
  terakhir_aktif timestamptz,
  terakhir_kirim timestamptz,
  total_terkirim integer not null default 0,
  error_terakhir text,
  interval_menit integer,
  min_batch integer
);
insert into public.tb_status_relayer (id)
values (1) on conflict (id) do nothing;
-- ---------------------------------------------------------
-- 2. FUNGSI BANTU
-- ---------------------------------------------------------
-- Cek apakah user yang sedang login adalah admin. SECURITY DEFINER supaya
-- tidak memicu rekursi RLS saat dipakai di dalam policy tabel tb_pengguna.
create or replace function public.is_admin() returns boolean language sql security definer
set search_path = public as $$
select exists (
    select 1
    from public.tb_pengguna p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'approved'
  );
$$;
revoke all on function public.is_admin()
from public;
grant execute on function public.is_admin() to authenticated;
-- Lookup email dari NIM (login & lupa password memakai NIM, sedangkan
-- Supabase Auth berbasis email). Hanya mengembalikan email.
create or replace function public.get_email_by_nim(input_nim text) returns text language sql security definer
set search_path = public as $$
select email
from public.tb_pengguna
where nim = input_nim
limit 1;
$$;
revoke all on function public.get_email_by_nim(text)
from public;
grant execute on function public.get_email_by_nim(text) to anon,
  authenticated;
-- Pendaftaran mahasiswa: mengaitkan akun login yang baru dibuat dengan baris tb_pengguna
-- yang sudah ada (berdasarkan NIM). Jika NIM belum ada, dibuat baris baru. Status tetap 'pending' sampai admin menyetujui.
create or replace function public.fn_daftar_mahasiswa(p_nim text, p_nama text, p_email text) returns text language plpgsql security definer
set search_path = public as $$
declare v_uid uuid := auth.uid();
v_row public.tb_pengguna %rowtype;
begin if v_uid is null then raise exception 'Anda harus login untuk menyelesaikan pendaftaran.';
end if;
if exists (
  select 1
  from public.tb_pengguna
  where id = v_uid
) then raise exception 'Akun ini sudah memiliki profil.';
end if;
select * into v_row
from public.tb_pengguna
where nim = p_nim for
update;
if found then if v_row.role <> 'mahasiswa'
or v_row.email is not null then raise exception 'NIM ini sudah terdaftar sebelumnya.';
end if;
-- nama_lengkap dari data admin dipertahankan
update public.tb_pengguna
set id = v_uid,
  email = p_email
where nim = p_nim;
else
insert into public.tb_pengguna (
    id,
    nim,
    nama_lengkap,
    email,
    role,
    status,
    has_voted
  )
values (
    v_uid,
    p_nim,
    p_nama,
    p_email,
    'mahasiswa',
    'pending',
    false
  );
end if;
return 'ok';
end;
$$;
revoke all on function public.fn_daftar_mahasiswa(text, text, text)
from public;
grant execute on function public.fn_daftar_mahasiswa(text, text, text) to authenticated;
-- Menjaga salinan status sesi agar meniru aturan kontrak blockchain:
--  * status hanya maju: belum_mulai -> berlangsung -> menutup -> selesai
--  * satu-satunya langkah mundur yang boleh: menutup -> berlangsung (admin membatalkan
--    penutupan sebelum transaksi penutupan dikirim ke blockchain)
--  * sesi yang sudah selesai tidak bisa dibuka lagi
--  * catatan waktu/wallet/transaksi yang sudah terisi tidak bisa diubah
create or replace function public.fn_jaga_transisi_sesi() returns trigger language plpgsql as $$
declare r_lama integer;
r_baru integer;
begin r_lama := case
  old.status
  when ' belum_mulai ' then 0
  when ' berlangsung ' then 1
  when ' menutup ' then 2
  else 3
end;
r_baru := case
  new.status
  when ' belum_mulai ' then 0
  when ' berlangsung ' then 1
  when ' menutup ' then 2
  else 3
end;
if old.status = ' selesai '
and new.status <> ' selesai ' then raise exception ' Sesi yang sudah selesai tidak dapat dibuka kembali.';
end if;
if r_baru < r_lama
and not (
  old.status = ' menutup '
  and new.status = ' berlangsung '
) then raise exception ' Status sesi tidak dapat dikembalikan ke tahap sebelumnya.';
end if;
if (
  old.dibuka_pada is not null
  and new.dibuka_pada is distinct
  from old.dibuka_pada
)
or (
  old.dibuka_oleh is not null
  and new.dibuka_oleh is distinct
  from old.dibuka_oleh
)
or (
  old.dibuka_tx is not null
  and new.dibuka_tx is distinct
  from old.dibuka_tx
)
or (
  old.ditutup_pada is not null
  and new.ditutup_pada is distinct
  from old.ditutup_pada
)
or (
  old.ditutup_oleh is not null
  and new.ditutup_oleh is distinct
  from old.ditutup_oleh
)
or (
  old.ditutup_tx is not null
  and new.ditutup_tx is distinct
  from old.ditutup_tx
) then raise exception ' Catatan pembukaan / penutupan sesi yang sudah tercatat tidak dapat diubah.';
end if;
return new;
end;
$$;
drop trigger if exists trg_jaga_transisi_sesi on public.tb_sesi_voting;
create trigger trg_jaga_transisi_sesi before
update on public.tb_sesi_voting for each row execute function public.fn_jaga_transisi_sesi();
-- Data kandidat dikunci begitu sesi dibuka: nomor paslon didaftarkan permanen di
-- kontrak blockchain saat sesi dibuka, jadi tidak boleh lagi berubah di database.
create or replace function public.fn_kunci_kandidat() returns trigger language plpgsql security definer
set search_path = public as $$ begin if exists (
    select 1
    from public.tb_sesi_voting s
    where s.id = 1
      and s.status <> ' belum_mulai '
  ) then raise exception ' Data kandidat dikunci karena sesi voting sudah dibuka.';
end if;
if tg_op = ' DELETE ' then return old;
end if;
return new;
end;
$$;
drop trigger if exists trg_kunci_kandidat on public.tb_kandidat;
create trigger trg_kunci_kandidat before
insert
  or
update
  or delete on public.tb_kandidat for each row execute function public.fn_kunci_kandidat();
-- Mengirim suara. Dalam SATU transaksi: tandai pemilih sudah memilih
-- (one person, one vote) dan masukkan suara anonim (hanya nomor paslon) ke antrian
-- yang akan dikirim relayer ke blockchain. Pemilih tidak bisa menulis ke antrian /
-- mengubah has_voted secara langsung; satu-satunya jalur adalah fungsi ini.
create or replace function public.fn_kirim_suara(p_kandidat_id uuid) returns text language plpgsql security definer
set search_path = public as $$
declare v_pengguna public.tb_pengguna %rowtype;
v_status_sesi text;
v_nomor integer;
begin -- Kunci baris pemilih supaya klik ganda / request paralel tidak lolos dua kali.
select * into v_pengguna
from public.tb_pengguna
where id = auth.uid() for
update;
if not found
or v_pengguna.role <> ' mahasiswa '
or v_pengguna.status <> ' approved ' then raise exception ' Akun Anda tidak berhak memberikan suara.';
end if;
if v_pengguna.has_voted then raise exception ' Anda sudah menggunakan hak suara.';
end if;
-- FOR SHARE: admin yang mengubah status sesi (mis. mulai menutup) menunggu suara yang
-- sedang diproses selesai, dan suara berikutnya langsung melihat status baru. Tidak ada
-- suara yang "menyelip" masuk antrian setelah admin mengira antrian sudah kosong.
select s.status into v_status_sesi
from public.tb_sesi_voting s
where s.id = 1 for share;
if v_status_sesi is distinct
from ' berlangsung ' then raise exception ' Sesi voting sedang tidak berlangsung.';
end if;
select k.nomor_paslon into v_nomor
from public.tb_kandidat k
where k.id = p_kandidat_id;
if v_nomor is null then raise exception ' Kandidat tidak ditemukan.';
end if;
update public.tb_pengguna
set has_voted = true
where id = v_pengguna.id;
insert into public.tb_antrian_suara (nomor_paslon)
values (v_nomor);
return ' ok ';
end;
$$;
revoke all on function public.fn_kirim_suara(uuid)
from public;
grant execute on function public.fn_kirim_suara(uuid) to authenticated;
-- Ringkasan jumlah (tanpa identitas apa pun) untuk transparansi: dipakai landing page dan
-- halaman admin untuk membandingkan jumlah pemilih dengan suara di blockchain.
create or replace function public.fn_ringkasan_suara() returns json language sql security definer
set search_path = public stable as $$
select json_build_object(
    ' sudah_memilih ',
    (
      select count(*)
      from public.tb_pengguna p
      where p.role = ' mahasiswa '
        and p.has_voted
    ),
    ' menunggu ',
    (
      select count(*)
      from public.tb_antrian_suara a
      where a.status = ' menunggu '
    ),
    ' diproses ',
    (
      select count(*)
      from public.tb_antrian_suara a
      where a.status = ' diproses '
    ),
    ' terkirim ',
    (
      select count(*)
      from public.tb_antrian_suara a
      where a.status = ' terkirim '
    )
  );
$$;
revoke all on function public.fn_ringkasan_suara()
from public;
grant execute on function public.fn_ringkasan_suara() to authenticated,
  service_role;
-- ---- Fungsi untuk RELAYER (hanya bisa dipanggil dengan service_role key) ----
-- Mengembalikan batch yang tersangkut (diambil tetapi tidak pernah ditandai terkirim,
-- misal relayer mati) ke antrian. Aman: kontrak menolak ID suara yang sudah dihitung.
create or replace function public.fn_lepas_kedaluwarsa(p_ttl_menit integer) returns integer language plpgsql security definer
set search_path = public as $$
declare v_jumlah integer;
begin
update public.tb_antrian_suara a
set status = ' menunggu ',
  batch_id = null,
  diproses_pada = null
where a.status = ' diproses '
  and a.diproses_pada <= now() - make_interval(mins => p_ttl_menit);
get diagnostics v_jumlah = row_count;
return v_jumlah;
end;
$$;
-- Mengambil satu batch dalam URUTAN ACAK. Hanya mengambil jika jumlah yang menunggu
-- mencapai p_min (agar satu suara tidak muncul sendirian di blockchain dan mudah
-- dicocokkan dengan waktu pemilihnya), KECUALI sesi sedang ' menutup ': saat itu semua
-- sisa suara diambil berapa pun jumlahnya.
create or replace function public.fn_ambil_batch_suara(p_batch_id uuid, p_min integer, p_maks integer) returns table (id_suara uuid, nomor integer) language plpgsql security definer
set search_path = public as $$
declare v_status text;
v_menunggu integer;
v_min integer;
begin
select s.status into v_status
from public.tb_sesi_voting s
where s.id = 1;
if v_status is distinct
from ' berlangsung '
  and v_status is distinct
from ' menutup ' then return;
end if;
v_min := case
  when v_status = ' menutup ' then 1
  else greatest(p_min, 1)
end;
select count(*) into v_menunggu
from public.tb_antrian_suara a
where a.status = ' menunggu ';
if v_menunggu < v_min then return;
end if;
return query with dipilih as (
  select a.id
  from public.tb_antrian_suara a
  where a.status = ' menunggu '
  order by random()
  limit greatest(p_maks, 1) for
  update skip locked
),
diubah as (
  update public.tb_antrian_suara t
  set status = ' diproses ',
    batch_id = p_batch_id,
    diproses_pada = now()
  from dipilih d
  where t.id = d.id
  returning t.id as id_baris,
    t.nomor_paslon as nomor_baris
)
select x.id_baris,
  x.nomor_baris
from diubah x;
end;
$$;
create or replace function public.fn_tandai_batch_terkirim(p_batch_id uuid, p_tx text) returns integer language plpgsql security definer
set search_path = public as $$
declare v_jumlah integer;
begin
update public.tb_antrian_suara a
set status = ' terkirim ',
  tx_hash = p_tx
where a.batch_id = p_batch_id
  and a.status = ' diproses ';
get diagnostics v_jumlah = row_count;
return v_jumlah;
end;
$$;
create or replace function public.fn_lepas_batch(p_batch_id uuid) returns integer language plpgsql security definer
set search_path = public as $$
declare v_jumlah integer;
begin
update public.tb_antrian_suara a
set status = ' menunggu ',
  batch_id = null,
  diproses_pada = null
where a.batch_id = p_batch_id
  and a.status = ' diproses ';
get diagnostics v_jumlah = row_count;
return v_jumlah;
end;
$$;
revoke all on function public.fn_lepas_kedaluwarsa(integer)
from public;
revoke all on function public.fn_ambil_batch_suara(uuid, integer, integer)
from public;
revoke all on function public.fn_tandai_batch_terkirim(uuid, text)
from public;
revoke all on function public.fn_lepas_batch(uuid)
from public;
grant execute on function public.fn_lepas_kedaluwarsa(integer) to service_role;
grant execute on function public.fn_ambil_batch_suara(uuid, integer, integer) to service_role;
grant execute on function public.fn_tandai_batch_terkirim(uuid, text) to service_role;
grant execute on function public.fn_lepas_batch(uuid) to service_role;
-- ---------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------
alter table public.tb_pengguna enable row level security;
alter table public.tb_kandidat enable row level security;
alter table public.tb_log_admin enable row level security;
-- tanpa policy: tidak bisa diakses langsung
alter table public.tb_sesi_voting enable row level security;
alter table public.tb_antrian_suara enable row level security;
-- tanpa policy: hanya lewat fungsi / service_role
alter table public.tb_status_relayer enable row level security;
-- Bersihkan policy lama (nama lama maupun nama baru) agar skrip bisa diulang.
drop policy if exists "profiles: user can read own row" on public.tb_pengguna;
drop policy if exists "profiles: user can insert own row" on public.tb_pengguna;
drop policy if exists "profiles: admin can read all" on public.tb_pengguna;
drop policy if exists "profiles: admin can update all" on public.tb_pengguna;
drop policy if exists "tb_pengguna: baca baris sendiri" on public.tb_pengguna;
drop policy if exists "tb_pengguna: daftar akun sendiri" on public.tb_pengguna;
drop policy if exists "tb_pengguna: admin baca semua" on public.tb_pengguna;
drop policy if exists "tb_pengguna: admin ubah semua" on public.tb_pengguna;
drop policy if exists "tb_kandidat: user login baca" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin tambah" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin ubah" on public.tb_kandidat;
drop policy if exists "tb_kandidat: admin hapus" on public.tb_kandidat;
drop policy if exists "tb_sesi_voting: user login baca" on public.tb_sesi_voting;
drop policy if exists "tb_sesi_voting: admin ubah" on public.tb_sesi_voting;
drop policy if exists "tb_status_relayer: admin baca" on public.tb_status_relayer;
drop policy if exists "tb_log_admin: user login baca" on public.tb_log_admin;
drop policy if exists "tb_log_admin: admin tambah" on public.tb_log_admin;
-- tb_pengguna
create policy "tb_pengguna: baca baris sendiri" on public.tb_pengguna for
select using (auth.uid() = id);
-- Saat registrasi, user hanya boleh membuat baris dirinya sendiri dengan nilai
-- awal yang wajar: mahasiswa harus ' pending ', dan tidak ada yang boleh
-- mendaftar dengan has_voted = true.
create policy "tb_pengguna: daftar akun sendiri" on public.tb_pengguna for
insert with check (
    auth.uid() = id
    and has_voted = false
    and (
      (
        role = ' mahasiswa '
        and status = ' pending '
      )
      or (
        role = ' admin '
        and status = ' approved '
      )
    )
  );
create policy "tb_pengguna: admin baca semua" on public.tb_pengguna for
select using (public.is_admin());
create policy "tb_pengguna: admin ubah semua" on public.tb_pengguna for
update using (public.is_admin());
-- Policy lama untuk fitur "Tambah Siswa" (sudah dihapus); baris ini membersihkannya dari database.
drop policy if exists "tb_pengguna: admin tambah data mahasiswa" on public.tb_pengguna;
-- tb_kandidat: semua user yang login boleh melihat, hanya admin yang menambah.
create policy "tb_kandidat: user login baca" on public.tb_kandidat for
select to authenticated using (true);
create policy "tb_kandidat: admin tambah" on public.tb_kandidat for
insert with check (public.is_admin());
create policy "tb_kandidat: admin ubah" on public.tb_kandidat for
update using (public.is_admin()) with check (public.is_admin());
-- Kandidat tidak bisa dihapus (atau diubah) setelah sesi dibuka: dijaga oleh trigger
-- trg_kunci_kandidat.
create policy "tb_kandidat: admin hapus" on public.tb_kandidat for delete using (public.is_admin());
-- tb_sesi_voting: semua user yang login boleh melihat, hanya admin yang boleh mengubah.
-- Tidak ada policy insert/delete: baris tunggalnya dibuat oleh skrip ini.
create policy "tb_sesi_voting: user login baca" on public.tb_sesi_voting for
select to authenticated using (true);
create policy "tb_sesi_voting: admin ubah" on public.tb_sesi_voting for
update using (public.is_admin()) with check (public.is_admin());
-- tb_status_relayer: hanya admin yang boleh melihat. Penulisnya relayer (service_role,
-- tidak terkena RLS), jadi tidak ada policy tulis.
create policy "tb_status_relayer: admin baca" on public.tb_status_relayer for
select using (public.is_admin());
-- tb_log_admin: semua user yang login boleh melihat, hanya admin yang menambah.
create policy "tb_log_admin: user login baca" on public.tb_log_admin for
select to authenticated using (true);
create policy "tb_log_admin: admin tambah" on public.tb_log_admin for
insert with check (public.is_admin());
-- ---------------------------------------------------------
-- 4. STORAGE: FOTO KANDIDAT
-- ---------------------------------------------------------
-- Bucket publik (foto kandidat memang ditampilkan ke semua pemilih), dibatasi
-- 2 MB per file dan hanya JPG/PNG/WEBP. Hanya admin yang boleh upload/hapus.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
values (
    ' foto - kandidat ',
    ' foto - kandidat ',
    true,
    2097152,
    array [' image / jpeg ', ' image / png ', ' image / webp ']
  ) on conflict (id) do
update
set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "foto_kandidat: publik baca" on storage.objects;
drop policy if exists "foto_kandidat: admin upload" on storage.objects;
drop policy if exists "foto_kandidat: admin hapus" on storage.objects;
-- Policy baca juga dibutuhkan agar admin bisa menghapus file (DELETE ... WHERE
-- ikut memeriksa policy SELECT).
create policy "foto_kandidat: publik baca" on storage.objects for
select using (bucket_id = ' foto - kandidat ');
create policy "foto_kandidat: admin upload" on storage.objects for
insert to authenticated with check (
    bucket_id = ' foto - kandidat '
    and public.is_admin()
  );
create policy "foto_kandidat: admin hapus" on storage.objects for delete to authenticated using (
  bucket_id = ' foto - kandidat '
  and public.is_admin()
);