// =========================================================
// Membuat akun login mahasiswa langsung dari CSV (NIM, nama, password).
// Dijalankan oleh panitia di komputer sendiri, TIDAK pernah lewat browser,
// karena membuat akun Supabase Auth untuk orang lain butuh SUPABASE_SERVICE_ROLE_KEY
// (kunci admin penuh) yang tidak boleh ada di kode sisi klien (browser).
//
// Dibuat dengan status langsung "approved": mahasiswa TIDAK perlu mendaftar sendiri
// atau menunggu Konfirmasi Pendaftaran lagi, cukup diberi NIM + password dari CSV ini.
//
// Bisa membaca .csv ATAU .xlsx (Excel). Kalau file .xlsx punya beberapa sheet (mis. satu
// sheet per angkatan), SEMUA sheet dibaca dan digabung jadi satu daftar; tidak perlu
// digabung manual dulu. Kalau satu sheet tidak punya kolom "angkatan", nama sheet itu
// sendiri dipakai sebagai nilai angkatan untuk baris-barisnya (mis. sheet "2023").
//
// Format kolom (header wajib ada di tiap sheet; urutan kolom bebas):
//   nim,nama_lengkap,password,prodi,angkatan
// Kolom prodi & angkatan opsional, boleh dikosongkan.
//
// Jalankan:  npm run buat-akun -- data_mahasiswa.csv
//       atau npm run buat-akun -- data_mahasiswa.xlsx
// =========================================================
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

function wajibkanEnv() {
  const wajib = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const kurang = wajib.filter((k) => !process.env[k] || !process.env[k].trim());
  if (kurang.length > 0) {
    console.error("Variabel .env berikut belum diisi: " + kurang.join(", "));
    console.error("Isi dulu SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di file .env (lihat README relayer).");
    process.exit(1);
  }
}

function emailDariNim(nim) {
  // Supabase Auth mewajibkan email meski mahasiswa tidak pernah memakainya untuk login.
  // Mahasiswa tetap login dengan NIM; Auth.js di web mengubah NIM ini jadi email yang sama.
  return `${nim}@voter.local`;
}

function rapikanBaris(r, namaSheet) {
  return {
    nim: String(r.nim ?? "").trim(),
    nama_lengkap: String(r.nama_lengkap ?? r.nama ?? "").trim(),
    password: String(r.password ?? "").trim(),
    prodi: String(r.prodi ?? "").trim() || null,
    // Sheet tanpa kolom angkatan -> pakai nama sheet-nya sendiri (mis. sheet "2023").
    angkatan: String(r.angkatan ?? "").trim() || (namaSheet ? String(namaSheet).trim() : null) || null,
  };
}

function bacaCsv(filePath) {
  const isi = fs.readFileSync(filePath, "utf8");
  const hasil = Papa.parse(isi, { header: true, skipEmptyLines: true });
  if (hasil.errors.length > 0) {
    console.error("CSV tidak valid:", hasil.errors[0].message);
    process.exit(1);
  }
  return hasil.data.map((r) => rapikanBaris(r));
}

function bacaXlsx(filePath) {
  const wb = XLSX.readFile(filePath);
  if (wb.SheetNames.length === 0) {
    console.error("File Excel tidak punya sheet sama sekali.");
    process.exit(1);
  }

  console.log(`Ditemukan ${wb.SheetNames.length} sheet: ${wb.SheetNames.join(", ")}`);

  const semuaBaris = [];
  for (const namaSheet of wb.SheetNames) {
    const sheet = wb.Sheets[namaSheet];
    const barisSheet = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (barisSheet.length === 0) {
      console.log(`  - Sheet "${namaSheet}": kosong, dilewati.`);
      continue;
    }
    console.log(`  - Sheet "${namaSheet}": ${barisSheet.length} baris.`);
    barisSheet.forEach((r) => semuaBaris.push(rapikanBaris(r, namaSheet)));
  }
  console.log("");
  return semuaBaris;
}

function bacaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mentah = ext === ".xlsx" || ext === ".xls" ? bacaXlsx(filePath) : bacaCsv(filePath);

  const baris = mentah.filter((r) => r.nim !== "");

  const masalah = [];
  baris.forEach((r, i) => {
    if (!r.nama_lengkap) masalah.push(`Baris ${i + 2}: nama_lengkap kosong (NIM ${r.nim}).`);
    if (!r.password) masalah.push(`Baris ${i + 2}: password kosong (NIM ${r.nim}).`);
    else if (r.password.length < 6) masalah.push(`Baris ${i + 2}: password NIM ${r.nim} kurang dari 6 karakter.`);
  });
  if (masalah.length > 0) {
    console.error("CSV belum bisa diproses:\n- " + masalah.join("\n- "));
    process.exit(1);
  }

  const nimDuplikat = baris.map((r) => r.nim).filter((n, i, arr) => arr.indexOf(n) !== i);
  if (nimDuplikat.length > 0) {
    console.error("NIM duplikat (mungkin lintas sheet): " + [...new Set(nimDuplikat)].join(", "));
    process.exit(1);
  }

  return baris;
}

async function main() {
  wajibkanEnv();

  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Pakai: npm run buat-akun -- <path_ke_file.csv_atau.xlsx>");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`File tidak ditemukan: ${csvPath}`);
    process.exit(1);
  }

  const baris = bacaFile(csvPath);
  console.log(`Total ${baris.length} baris siap diproses dari ${path.basename(csvPath)}.\n`);

  const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const dibuat = [];
  const dilewati = [];
  const gagal = [];

  for (const r of baris) {
    // NIM yang sudah punya akun (pernah didaftarkan / dibuat sebelumnya) dilewati,
    // supaya tidak menimpa akun yang sudah aktif.
    const { data: adaAkun, error: errCek } = await sb
      .from("tb_pengguna")
      .select("id, email")
      .eq("nim", r.nim)
      .maybeSingle();

    if (errCek) {
      gagal.push(`${r.nim}: gagal memeriksa data lama (${errCek.message})`);
      continue;
    }
    if (adaAkun && adaAkun.email) {
      dilewati.push(`${r.nim} (sudah punya akun)`);
      continue;
    }

    const email = emailDariNim(r.nim);
    const { data: akunBaru, error: errAuth } = await sb.auth.admin.createUser({
      email,
      password: r.password,
      email_confirm: true,
    });

    if (errAuth) {
      gagal.push(`${r.nim}: gagal membuat akun login (${errAuth.message})`);
      continue;
    }

    const baseRow = {
      nim: r.nim,
      nama_lengkap: r.nama_lengkap,
      email,
      prodi: r.prodi,
      angkatan: r.angkatan,
      role: "mahasiswa",
      status: "approved",
      has_voted: false,
    };

    const { error: errSimpan } = adaAkun
      ? await sb.from("tb_pengguna").update({ ...baseRow, id: akunBaru.user.id }).eq("nim", r.nim)
      : await sb.from("tb_pengguna").insert({ ...baseRow, id: akunBaru.user.id });

    if (errSimpan) {
      // Akun login sudah terlanjur dibuat; hapus lagi supaya tidak jadi akun "yatim" tanpa profil.
      await sb.auth.admin.deleteUser(akunBaru.user.id).catch(() => { });
      gagal.push(`${r.nim}: gagal menyimpan profil (${errSimpan.message})`);
      continue;
    }

    dibuat.push(r);
  }

  console.log(`Berhasil dibuat : ${dibuat.length}`);
  console.log(`Dilewati        : ${dilewati.length}${dilewati.length ? " -> " + dilewati.join(", ") : ""}`);
  console.log(`Gagal           : ${gagal.length}${gagal.length ? "\n- " + gagal.join("\n- ") : ""}`);

  if (dibuat.length > 0) {
    const outPath = path.join(path.dirname(csvPath), "akun_dibuat_" + Date.now() + ".csv");
    const outCsv = Papa.unparse(dibuat.map((r) => ({ nim: r.nim, nama_lengkap: r.nama_lengkap, password: r.password })));
    fs.writeFileSync(outPath, outCsv, "utf8");
    console.log(`\nDaftar akun yang berhasil dibuat disimpan di: ${outPath}`);
    console.log("Bagikan NIM + password di file itu ke tiap mahasiswa (mis. dicetak), lalu simpan file ini di tempat aman / hapus setelah dibagikan.");
  }
}

main().catch((e) => {
  console.error("Terjadi kesalahan tak terduga:", e.message || e);
  process.exit(1);
});