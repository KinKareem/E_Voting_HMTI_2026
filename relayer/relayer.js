#!/usr/bin/env node
/* =========================================================
   relayer.js — E-Voting HMTI

   Tugas: mengambil suara anonim dari antrian di database (tb_antrian_suara) lalu
   mengirimnya ke smart contract VotingSession dalam batch berurutan ACAK, memakai
   wallet relayer (yang membayar gas). Mahasiswa tidak perlu wallet.

   Cara menjalankan (lihat PANDUAN_RELAYER.md):
     npm install
     cp .env.example .env      (lalu isi .env)
     npm start                 -> berjalan terus, memeriksa tiap CEK_DETIK detik
     npm run sekali            -> satu siklus lalu selesai (mengabaikan selang waktu)
     npm run paksa             -> satu siklus, mengabaikan selang waktu DAN batas minimal batch

   Aturan pengiriman:
   - Saat sesi 'berlangsung': kirim tiap INTERVAL_MENIT, hanya jika suara yang menunggu
     >= MIN_BATCH (kerahasiaan: satu suara yang muncul sendirian mudah dicocokkan dengan
     waktu pemilihnya).
   - Saat sesi 'menutup' (admin sedang menutup sesi): kirim SEMUA sisa suara segera,
     berapa pun jumlahnya.
   - Urutan suara di dalam batch diacak oleh database (order by random()).

   Aman terhadap mati mendadak: setiap suara membawa ID acak, dan kontrak menolak ID yang
   sudah pernah dihitung. Jadi batch yang tersangkut boleh dikirim ulang kapan pun tanpa
   risiko suara dihitung dua kali.

   Privasi: file ini hanya melihat (ID acak, nomor paslon), tidak pernah identitas pemilih,
   dan tidak mencatat isi suara di log.
   ========================================================= */

"use strict";

require("dotenv").config();
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { ethers } = require("ethers");

// Potongan ABI yang dibutuhkan relayer (sesuai blockchain/VotingSession.sol)
const ABI = [
  "function relayer() view returns (address)",
  "function status() view returns (uint8)",
  "function castVotes(bytes32[] ids, uint8[] numbers)",
  "event VotesCast(uint256 accepted, uint256 duplicates, uint256 totalVotes)",
  "error NotRelayer()",
  "error InvalidState(uint8 current)",
  "error InvalidCandidate(uint8 number)",
  "error InvalidBatch()",
];

const MAKS_BATCH_PER_SIKLUS = 20; // pengaman: maksimal batch dalam satu siklus
const TUNGGU_KONFIRMASI_MS = 5 * 60 * 1000;

const log = (...args) =>
  console.log(new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" }), "|", ...args);

const tidur = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------
function angka(env, nama, bawaan, { min = 1, maks = Infinity } = {}) {
  const mentah = env[nama];
  if (mentah === undefined || mentah === "") return bawaan;
  const n = Number(mentah);
  if (!Number.isFinite(n) || n < min || n > maks) {
    throw new Error(`${nama} harus berupa angka antara ${min} dan ${maks} (nilai sekarang: "${mentah}")`);
  }
  return n;
}

function bacaKonfigurasi(env = process.env) {
  const wajib = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RPC_URL", "CONTRACT_ADDRESS", "RELAYER_PRIVATE_KEY"];
  const kurang = wajib.filter((k) => !env[k] || /isi-dengan|xxxxxxxx|^0x\.\.\.$/.test(env[k]));
  if (kurang.length) throw new Error(`Variabel di file .env belum diisi: ${kurang.join(", ")}`);

  if (!ethers.isAddress(env.CONTRACT_ADDRESS)) throw new Error("CONTRACT_ADDRESS bukan alamat yang valid.");

  let kunci = env.RELAYER_PRIVATE_KEY.trim();
  if (!kunci.startsWith("0x")) kunci = "0x" + kunci;
  if (!/^0x[0-9a-fA-F]{64}$/.test(kunci)) {
    throw new Error("RELAYER_PRIVATE_KEY tidak valid (harus 64 karakter heksadesimal).");
  }

  return {
    supabaseUrl: env.SUPABASE_URL.trim(),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY.trim(),
    rpcUrl: env.RPC_URL.trim(),
    chainId: angka(env, "CHAIN_ID", 11155111),
    contractAddress: env.CONTRACT_ADDRESS.trim(),
    privateKey: kunci,
    intervalMs: Math.round(angka(env, "INTERVAL_MENIT", 30, { min: 0.1 }) * 60 * 1000),
    minBatch: angka(env, "MIN_BATCH", 5),
    maksBatch: angka(env, "MAKS_BATCH", 50, { maks: 100 }),
    ttlMenit: angka(env, "TTL_MENIT", 15),
    tickMs: angka(env, "CEK_DETIK", 20, { min: 5 }) * 1000,
  };
}

function buatKonteks(cfg) {
  const sb = createClient(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jaringan = ethers.Network.from(cfg.chainId);
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl, jaringan, {
    staticNetwork: jaringan,
    batchMaxCount: 1, // beberapa RPC publik menolak permintaan yang digabung
  });
  const wallet = new ethers.Wallet(cfg.privateKey, provider);
  const contract = new ethers.Contract(cfg.contractAddress, ABI, wallet);
  return { cfg, sb, provider, wallet, contract, state: { terakhirCoba: 0, totalTerkirim: 0, pesanTerakhir: null } };
}

// ---------------------------------------------------------
// Bantuan
// ---------------------------------------------------------
function ringkas(e) {
  if (e && e.revert && e.revert.name) {
    const args = e.revert.args && e.revert.args.length ? ` (${e.revert.args.join(", ")})` : "";
    return `kontrak menolak: ${e.revert.name}${args}`;
  }
  return (e && (e.shortMessage || e.message)) || String(e);
}

// Menulis "detak jantung" yang dibaca halaman admin (aktif atau tidak, error terakhir).
async function detak(ctx, pesanError, tambahan = {}) {
  const { cfg, sb, wallet } = ctx;
  const { error } = await sb
    .from("tb_status_relayer")
    .update({
      alamat_relayer: wallet.address,
      terakhir_aktif: new Date().toISOString(),
      error_terakhir: pesanError || null,
      interval_menit: Math.round(cfg.intervalMs / 60000),
      min_batch: cfg.minBatch,
      ...tambahan,
    })
    .eq("id", 1);
  if (error) log("Peringatan: gagal menulis detak jantung ke database:", error.message);
}

// ---------------------------------------------------------
// Mengirim satu batch ke kontrak
// ---------------------------------------------------------
async function kirimBatch(ctx, batchId, rows) {
  const { sb, contract } = ctx;

  // ID acak suara (uuid, 16 byte) -> bytes32
  const ids = rows.map((r) => ethers.zeroPadValue("0x" + String(r.id_suara).replace(/-/g, ""), 32));
  const nomor = rows.map((r) => Number(r.nomor));

  try {
    // Simulasi dulu (tanpa biaya): jika kontrak akan menolak, kita tahu alasannya sebelum mengirim.
    await contract.castVotes.staticCall(ids, nomor);

    const tx = await contract.castVotes(ids, nomor);
    log(`Batch ${rows.length} suara dikirim (tx ${tx.hash}). Menunggu konfirmasi...`);

    const receipt = await tx.wait(1, TUNGGU_KONFIRMASI_MS);
    if (!receipt || receipt.status !== 1) throw new Error("Transaksi gagal di blockchain.");

    // Ringkasan dari event kontrak (hanya jumlah)
    let ringkasan = "";
    for (const entri of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(entri);
        if (parsed && parsed.name === "VotesCast") {
          ringkasan = ` (diterima ${parsed.args.accepted}, sudah pernah dihitung ${parsed.args.duplicates}, total di blockchain ${parsed.args.totalVotes})`;
        }
      } catch (_) {
        /* log lain, abaikan */
      }
    }
    log(`Batch terkonfirmasi${ringkasan}.`);

    const { error } = await sb.rpc("fn_tandai_batch_terkirim", { p_batch_id: batchId, p_tx: receipt.hash });
    if (error) {
      // Suara SUDAH ada di blockchain; hanya penandaan di database yang gagal. Batch akan
      // dikembalikan ke antrian setelah TTL dan dikirim ulang; kontrak menolak hitungan ganda.
      throw new Error(`Transaksi berhasil tetapi gagal menandai batch (${error.message}). Akan dicoba ulang otomatis.`);
    }
    return { jumlah: rows.length, txHash: receipt.hash };
  } catch (e) {
    // Mengembalikan batch ke antrian selalu aman, karena pengiriman ulang tidak pernah
    // menghitung suara dua kali (kontrak menolak ID yang sama).
    const { error } = await sb.rpc("fn_lepas_batch", { p_batch_id: batchId });
    if (error) log("Peringatan: gagal mengembalikan batch ke antrian:", error.message);
    throw e;
  }
}

// ---------------------------------------------------------
// Satu siklus pemeriksaan
// ---------------------------------------------------------
async function siklus(ctx, opsi = {}) {
  // 0. Alamat kontrak aktif menurut database (diatur admin di menu Sesi Voting, berubah saat
  //    pemilihan baru). CONTRACT_ADDRESS di .env hanya cadangan bila database belum mengaturnya.
  try {
    const { data: kontrak, error } = await ctx.sb
      .from("tb_pengaturan_kontrak")
      .select("contract_address")
      .eq("id", 1)
      .maybeSingle();
    const baru = !error && kontrak && kontrak.contract_address;
    if (baru && baru.toLowerCase() !== ctx.cfg.contractAddress.toLowerCase()) {
      log(`Alamat kontrak di database berubah: ${ctx.cfg.contractAddress} -> ${baru}`);
      ctx.cfg.contractAddress = baru;
      ctx.contract = new ethers.Contract(baru, ABI, ctx.wallet);
    }
  } catch (_) {
    /* tabel belum ada atau database sulit dijangkau: tetap pakai alamat yang sedang dipakai */
  }

  const { cfg, sb, wallet, contract, state } = ctx;
  const sekarang = Date.now();
  const hasil = (dikirim, galat, pesan) => ({ dikirim, galat: galat || null, pesan });

  // 1. Status sesi menurut database
  const { data: sesi, error: errSesi } = await sb.from("tb_sesi_voting").select("status").eq("id", 1).single();
  if (errSesi || !sesi) {
    const m = `Gagal membaca status sesi dari database: ${errSesi ? errSesi.message : "baris tidak ditemukan"}`;
    await detak(ctx, m);
    return hasil(0, m, m);
  }

  // 2. Kembalikan batch yang tersangkut terlalu lama
  const { data: dilepas, error: errLepas } = await sb.rpc("fn_lepas_kedaluwarsa", { p_ttl_menit: cfg.ttlMenit });
  if (errLepas) log("Peringatan: gagal memeriksa batch tersangkut:", errLepas.message);
  else if (dilepas > 0) log(`${dilepas} suara tersangkut dikembalikan ke antrian.`);

  // 3. Keadaan kontrak & kesesuaian wallet
  let statusChain;
  let relayerChain;
  try {
    [statusChain, relayerChain] = await Promise.all([contract.status(), contract.relayer()]);
  } catch (e) {
    const m = `Gagal membaca kontrak: ${ringkas(e)}`;
    await detak(ctx, m);
    return hasil(0, m, m);
  }
  if (relayerChain.toLowerCase() !== wallet.address.toLowerCase()) {
    const m = `Wallet ini (${wallet.address}) bukan relayer yang terdaftar di kontrak (${relayerChain}).`;
    await detak(ctx, m);
    return hasil(0, m, m);
  }

  // 4. Apakah sesi sedang menerima suara, dan sudah saatnya mengirim?
  const menutup = sesi.status === "menutup";
  const sesiAktif = Number(statusChain) === 1 && (sesi.status === "berlangsung" || menutup);
  if (!sesiAktif) {
    await detak(ctx, null);
    return hasil(0, null, "Sesi tidak sedang menerima suara.");
  }

  const saatnya = menutup || opsi.sekali || sekarang - state.terakhirCoba >= cfg.intervalMs;
  if (!saatnya) {
    await detak(ctx, null);
    return hasil(0, null, "Belum saatnya mengirim.");
  }
  state.terakhirCoba = sekarang;

  // 5. Ambil & kirim batch (acak, minimal MIN_BATCH kecuali sesi sedang menutup / --paksa)
  let total = 0;
  let galat = null;
  for (let i = 0; i < MAKS_BATCH_PER_SIKLUS; i++) {
    const batchId = crypto.randomUUID();
    const { data: rows, error } = await sb.rpc("fn_ambil_batch_suara", {
      p_batch_id: batchId,
      p_min: opsi.paksa ? 1 : cfg.minBatch,
      p_maks: cfg.maksBatch,
    });
    if (error) {
      galat = `Gagal mengambil antrian: ${error.message}`;
      break;
    }
    if (!rows || rows.length === 0) break;

    try {
      const h = await kirimBatch(ctx, batchId, rows);
      total += h.jumlah;
    } catch (e) {
      galat = `Gagal mengirim batch: ${ringkas(e)}`;
      break;
    }
  }

  if (total > 0) {
    state.totalTerkirim += total;
    await detak(ctx, galat, { terakhir_kirim: new Date().toISOString(), total_terkirim: state.totalTerkirim });
  } else {
    await detak(ctx, galat);
  }

  const pesan = galat || (total > 0 ? `${total} suara terkirim ke blockchain.` : "Belum ada batch yang memenuhi syarat (suara menunggu kurang dari minimal).");
  return hasil(total, galat, pesan);
}

// ---------------------------------------------------------
// Program utama
// ---------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const opsi = { sekali: args.includes("--sekali"), paksa: args.includes("--paksa") };

  let cfg;
  try {
    cfg = bacaKonfigurasi();
  } catch (e) {
    console.error(`\nKonfigurasi bermasalah: ${e.message}\nPeriksa file .env (contoh: .env.example).\n`);
    process.exit(1);
  }

  const ctx = buatKonteks(cfg);
  log("Relayer dimulai.");
  log(`Alamat relayer : ${ctx.wallet.address}`);
  log(`Kontrak        : ${cfg.contractAddress} (chain ${cfg.chainId})`);
  log(
    `Pengaturan     : kirim tiap ${Math.round(cfg.intervalMs / 60000)} menit, minimal ${cfg.minBatch} suara, maksimal ${cfg.maksBatch} per transaksi, pemeriksaan tiap ${cfg.tickMs / 1000} detik`
  );
  if (opsi.sekali) log(`Mode: satu siklus${opsi.paksa ? " (mengabaikan batas minimal)" : ""}.`);

  // Pemulihan saat start: kembalikan SEMUA batch yang masih tertandai 'diproses'. Aman walau
  // ada relayer lain yang sedang berjalan, karena kontrak menolak hitungan ganda.
  const { data: pulih, error: errPulih } = await ctx.sb.rpc("fn_lepas_kedaluwarsa", { p_ttl_menit: 0 });
  if (errPulih) log("Peringatan: gagal memulihkan batch tersangkut:", errPulih.message);
  else if (pulih > 0) log(`${pulih} suara yang tersangkut dari sesi sebelumnya dikembalikan ke antrian.`);

  const { data: st } = await ctx.sb.from("tb_status_relayer").select("total_terkirim").eq("id", 1).single();
  if (st) ctx.state.totalTerkirim = st.total_terkirim || 0;

  let berhenti = false;
  let bangunkan = () => { };
  const sinyal = new Promise((resolve) => {
    bangunkan = resolve;
  });
  const hentikan = () => {
    if (berhenti) return;
    log("Menghentikan relayer...");
    berhenti = true;
    bangunkan();
  };
  process.on("SIGINT", hentikan);
  process.on("SIGTERM", hentikan);

  while (!berhenti) {
    try {
      const h = await siklus(ctx, opsi);
      // Hindari memenuhi layar: catat hanya jika ada suara terkirim atau pesan error baru
      if (h.dikirim > 0 || (h.galat && h.galat !== ctx.state.pesanTerakhir) || opsi.sekali) log(h.pesan);
      ctx.state.pesanTerakhir = h.galat;
    } catch (e) {
      const m = `Kesalahan tak terduga: ${ringkas(e)}`;
      if (m !== ctx.state.pesanTerakhir) log(m);
      ctx.state.pesanTerakhir = m;
      try {
        await detak(ctx, m);
      } catch (_) {
        /* abaikan */
      }
    }
    if (opsi.sekali) break;
    await Promise.race([tidur(cfg.tickMs), sinyal]);
  }
  log("Relayer berhenti.");
  process.exit(0);
}

module.exports = { bacaKonfigurasi, buatKonteks, siklus, kirimBatch, ABI };

if (require.main === module) {
  main().catch((e) => {
    console.error("Relayer berhenti karena kesalahan:", ringkas(e));
    process.exit(1);
  });
}