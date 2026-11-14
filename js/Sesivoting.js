/* =========================================================
   Sesivoting.js
   Logic untuk admin/sesi-voting.html — mengelola sesi voting lewat smart contract
   VotingSession, memantau relayer & antrian suara, dan menampilkan hasil akhir.

   Alur singkat:
   1. Status sesi, jumlah suara, dan hasil DIBACA dari blockchain (RPC publik, tanpa wallet).
   2. Admin menghubungkan MetaMask (harus wallet pemilik kontrak).
   3. MULAI: daftar nomor paslon dari database dikunci ke kontrak saat sesi dibuka.
   4. TUTUP (bertahap, agar tidak ada suara hilang):
        a. database berhenti menerima suara baru (status 'menutup')
        b. relayer mengirim semua sisa antrian ke blockchain (halaman ini menunggu)
        c. baru sesi ditutup di blockchain lewat MetaMask
        d. salinan status di database diperbarui ke 'selesai'
   5. Status sesi disalin ke tabel tb_sesi_voting setelah transaksi terkonfirmasi, supaya
      server bisa menolak suara di luar sesi (database tidak bisa membaca blockchain).
   ========================================================= */

// =========================================================
// NOTIFIKASI (TOAST) — slide masuk dari kanan bawah layar.
// Ditulis langsung di halaman ini, tidak bergantung pada file lain.
// Pemakaian: showToast("success" | "error" | "info", "pesan");
// Tampilannya diatur di css/style.css (bagian TOAST).
// =========================================================
function showToast(type, message) {
  let box = document.getElementById("toast-container");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-container";
    box.className = "toast-container";
    document.body.appendChild(box);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.style.cssText = "width:18px;text-align:center;font-weight:700";
  icon.textContent = type === "success" ? "\u2713" : type === "error" ? "!" : "i";

  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = message; // textContent: aman dari HTML injection

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Tutup notifikasi");
  close.textContent = "\u00d7";

  toast.append(icon, text, close);
  box.appendChild(toast);
  while (box.children.length > 4) box.firstElementChild.remove(); // maksimal 4 sekaligus

  // Hilang otomatis; berhenti dihitung saat kursor di atas toast supaya sempat dibaca
  const dismiss = () => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 450);
  };
  let timer = setTimeout(dismiss, type === "error" ? 6500 : 4000);
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", () => {
    timer = setTimeout(dismiss, 2500);
  });
  close.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });

  // Class "toast-show" ditambahkan di frame berikutnya agar transisi slide berjalan
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-show")));
}

// ---------------------------------------------------------
// Konstanta, elemen & state
// ---------------------------------------------------------
const RELAYER_STALE_MS = 150 * 1000; // relayer otomatis dipanggil tiap menit; beri toleransi keterlambatan
const RELAYER_FN_URL = `${SUPABASE_URL}/functions/v1/relayer`; // Edge Function relayer
const LIVE_REFRESH_MS = 15 * 1000; // pembaruan otomatis ringkasan antrian & relayer
const QUEUE_POLL_MS = 4000; // saat menunggu antrian kosong ketika menutup sesi

const byId = (id) => document.getElementById(id);

const el = {
  configAlert: byId("config-alert"),
  badge: byId("session-badge"),
  openedInfo: byId("opened-info"),
  closedInfo: byId("closed-info"),
  ownerInfo: byId("owner-info"),
  contractInfo: byId("contract-info"),
  networkInfo: byId("network-info"),
  dbInfo: byId("db-info"),
  btnOpen: byId("btn-open"),
  btnClose: byId("btn-close"),
  btnCancelClose: byId("btn-cancel-close"),
  hint: byId("action-hint"),
  refreshBtn: byId("refresh-btn"),
  walletAddress: byId("wallet-address"),
  walletChips: byId("wallet-chips"),
  walletHelp: byId("wallet-help"),
  btnConnect: byId("btn-connect"),
  btnSwitch: byId("btn-switch"),
  relayerChain: byId("relayer-chain"),
  relayerLive: byId("relayer-live"),
  queueInfo: byId("queue-info"),
  chainVotes: byId("chain-votes"),
  votedInfo: byId("voted-info"),
  verifyInfo: byId("verify-info"),
  relayerInput: byId("relayer-input"),
  btnSetRelayer: byId("btn-set-relayer"),
  relayerHint: byId("relayer-hint"),
  relayerToggle: byId("relayer-toggle"),
  relayerToggleLabel: byId("relayer-toggle-label"),
  btnRelayerCek: byId("btn-relayer-cek"),
  btnRelayerKirim: byId("btn-relayer-kirim"),
  relayerCtlHint: byId("relayer-ctl-hint"),
  kontrakAktif: byId("kontrak-aktif"),
  kontrakSumber: byId("kontrak-sumber"),
  kontrakDiubah: byId("kontrak-diubah"),
  kontrakInput: byId("kontrak-input"),
  kontrakReset: byId("kontrak-reset"),
  btnSetKontrak: byId("btn-set-kontrak"),
  kontrakHint: byId("kontrak-hint"),
  resultsPanel: byId("results-panel"),
  resultsBody: byId("results-body"),
  resultsNote: byId("results-note"),
  overlay: byId("tx-overlay"),
  modal: byId("tx-modal"),
  viewConfirm: byId("tx-view-confirm"),
  viewProgress: byId("tx-view-progress"),
  title: byId("tx-title"),
  text: byId("tx-text"),
  points: byId("tx-points"),
  warning: byId("tx-warning"),
  btnCancel: byId("tx-cancel"),
  btnConfirm: byId("tx-confirm"),
  progressTitle: byId("tx-progress-title"),
  steps: byId("tx-steps"),
  note: byId("tx-note"),
  result: byId("tx-result"),
  btnAbort: byId("tx-abort"),
  btnRetry: byId("tx-retry"),
  btnClose2: byId("tx-close"),
};

let chainState = null; // keadaan sesi dari blockchain
let chainError = null;
let chainResults = null; // { numbers, counts } (hanya dibaca setelah sesi ditutup)
let dbState = null; // baris tb_sesi_voting
let dbError = null;
let syncError = null;
let kandidatDb = null; // daftar kandidat dari database (null = gagal dibaca)
let relayerRow = null; // baris tb_status_relayer (detak jantung relayer)
let summaryBefore = null; // ringkasan antrian SEBELUM membaca blockchain
let summaryAfter = null; // ringkasan antrian SESUDAH membaca blockchain
let wallet = null; // { provider, address, chainId }
let busy = false; // true selama aksi diproses
let pendingAction = null; // "open" | "close" | "relayer"
let pendingNumbers = []; // nomor paslon yang akan dikunci saat membuka sesi
let pendingRelayerAddress = null;
let kontrakRow = null; // baris tb_pengaturan_kontrak (null = belum bisa dibaca)
let kontrakFiturAktif = false; // false = patch_kontrak_dinamis.sql belum dijalankan
let pendingKontrak = null; // { alamat, reset } yang akan diterapkan
let liveStarted = false;
let relayerBusy = false; // true selama saklar / tombol relayer diproses
let relayerCtlMessage = ""; // pesan hasil aksi relayer terakhir (tampil di bawah tombol)
let currentStep = null;
let abortRequested = false;
let lastFocusedEl = null;
let walletListenersAttached = false;

const STATUS_LABEL = { 0: "Belum dimulai", 1: "Sedang berlangsung", 2: "Telah ditutup" };
const DB_LABEL = {
  belum_mulai: "Belum dimulai",
  berlangsung: "Sedang berlangsung",
  menutup: "Sedang ditutup (menunggu antrian suara kosong)",
  selesai: "Telah ditutup",
};

const STEP_LABEL = {
  relayer: "Memeriksa relayer otomatis",
  kontrak: "Memeriksa kontrak di blockchain",
  stop: "Menghentikan penerimaan suara baru",
  flush: "Mengirim sisa suara ke blockchain",
  wallet: "Konfirmasi di MetaMask",
  chain: "Menunggu konfirmasi jaringan blockchain",
  db: "Memperbarui database",
};

const ACTIONS = {
  open: {
    title: "Mulai Sesi Voting?",
    text: "Anda akan membuka sesi pemilihan Ketua HMTI di blockchain.",
    points: [
      "Mahasiswa yang sudah disetujui dapat langsung memberikan suara.",
      "Pembukaan sesi dicatat permanen bersama alamat wallet Anda dan waktunya.",
      "Sebelum dibuka, relayer diperiksa dulu. Sesi tidak akan dibuka jika relayer belum siap, supaya suara tidak tertahan.",
      "Anda perlu mengonfirmasi transaksi di MetaMask dan membayar biaya gas.",
    ],
    warning: "Pastikan data kandidat sudah lengkap dan benar sebelum memulai.",
    danger: false,
    confirmLabel: "Ya, Mulai Sesi",
    confirmClass: "btn-primary",
    progressTitle: "Membuka sesi voting",
    steps: ["relayer", "wallet", "chain", "db"],
    confirmState: (s) => s.status === 1,
    success: "Sesi voting berhasil dibuka.",
  },
  close: {
    title: "Tutup Sesi Voting?",
    text: "Anda akan menutup sesi pemilihan Ketua HMTI secara permanen.",
    points: [
      "Penerimaan suara baru dihentikan, lalu semua sisa suara di antrian dikirim ke blockchain oleh relayer (relayer harus aktif dan tidak dijeda).",
      "Setelah antrian kosong, sesi ditutup di blockchain dan TIDAK dapat dibuka kembali.",
      "Mahasiswa tidak dapat lagi memberikan suara. Hasil akhir dapat dilihat semua orang.",
    ],
    warning: "Tindakan ini tidak dapat dibatalkan setelah transaksi penutupan dikonfirmasi. Pastikan pemilihan memang sudah selesai.",
    danger: true,
    confirmLabel: "Ya, Tutup Sesi",
    confirmClass: "btn-danger-solid",
    progressTitle: "Menutup sesi voting",
    steps: ["stop", "flush", "wallet", "chain", "db"],
    confirmState: (s) => s.status === 2,
    success: "Sesi voting berhasil ditutup.",
  },
  kontrak: {
    title: "Terapkan Kontrak Pemilihan?",
    text: "",
    points: [],
    warning: "",
    danger: true,
    confirmLabel: "Ya, Terapkan",
    confirmClass: "btn-danger-solid",
    progressTitle: "Menerapkan kontrak pemilihan",
    steps: ["kontrak", "db"],
    confirmState: () => true,
    success: "Kontrak pemilihan berhasil diterapkan.",
  },
  relayer: {
    title: "Ganti Relayer?",
    text: "",
    points: [
      "Hanya alamat ini yang dapat mengirim suara ke blockchain.",
      "Relayer sebelumnya langsung tidak berlaku lagi.",
      "Anda perlu mengonfirmasi transaksi di MetaMask dan membayar biaya gas.",
    ],
    warning:
      "Pastikan Anda memegang private key alamat tersebut dan memperbarui RELAYER_PRIVATE_KEY (secret Supabase untuk relayer otomatis, atau file .env untuk relayer manual). Jika salah alamat, suara tidak bisa terkirim sampai relayer diganti lagi.",
    danger: false,
    confirmLabel: "Ya, Ganti Relayer",
    confirmClass: "btn-primary",
    progressTitle: "Mengganti relayer",
    steps: ["wallet", "chain"],
    confirmState: (s) => sameAddress(s.relayer, pendingRelayerAddress),
    success: "Relayer berhasil diganti.",
  },
};

const DEFAULT_KONTRAK_HINT =
  'Tempel alamat kontrak hasil deploy. Jika opsi di bawah dicentang, data pemilihan sebelumnya ikut dikosongkan (untuk pemilihan baru).';

const DEFAULT_RELAYER_HINT =
  "Gunakan jika wallet relayer lama hilang atau rusak. Hanya wallet pemilik kontrak yang bisa mengganti relayer.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Batas waktu menunggu konfirmasi transaksi di tahap "chain" sebelum popup berhenti
// menunggu diam-diam dan menawarkan "Coba Muat Ulang Status". Transaksi yang sudah
// terkirim TETAP bisa terkonfirmasi setelah batas ini lewat; ini hanya menghentikan
// popup dari menunggu tanpa batas kalau jaringan admin macet/putus.
const TX_CONFIRM_TIMEOUT_MS = 150_000; // 2.5 menit

// ---------------------------------------------------------
// Inisialisasi & pemuatan data
// ---------------------------------------------------------
function startLiveRefresh() {
  if (liveStarted) return;
  liveStarted = true;
  // Pembaruan otomatis ringan (ringkasan antrian, detak relayer, status chain)
  setInterval(async () => {
    if (busy || document.hidden) return;
    await loadLive();
    render();
  }, LIVE_REFRESH_MS);
}

async function init() {
  // Alamat kontrak aktif diatur admin di database; muat dulu sebelum memakai kontrak.
  await muatAlamatKontrak();
  el.networkInfo.textContent = `${BLOCKCHAIN.CHAIN_NAME} (ID ${BLOCKCHAIN.CHAIN_ID})`;
  el.contractInfo.textContent = BLOCKCHAIN.CONTRACT_ADDRESS || "Belum diatur";

  const problem = blockchainConfigProblem();
  if (problem) {
    el.configAlert.textContent = problem;
    el.configAlert.className = "status-msg error";
    chainError = problem;
    // Tetap muat status database agar admin bisa mengatur alamat kontrak lewat panel Kontrak Pemilihan
    await Promise.all([loadDb(), loadKontrakRow()]);
    render();
    return;
  }

  await restoreWallet();
  await loadAll();
  startLiveRefresh();
}

async function loadAll() {
  setBadge("loading", "Memuat...");
  await Promise.all([loadDb(), loadKandidatDb(), loadKontrakRow()]);
  await loadLive();
  await autoSync();
  render();
}

// Urutan penting untuk pemeriksaan konsistensi: ringkasan database dibaca SEBELUM dan
// SESUDAH membaca blockchain (lihat verifyConsistency).
async function loadLive() {
  summaryBefore = await fetchSummary();
  await loadChain(getReadProvider());
  summaryAfter = await fetchSummary();
  await loadRelayerRow();
  if (chainState && chainState.status === 2) await loadResults();
}

async function loadChain(runner) {
  try {
    chainState = await readSessionState(getSessionContract(runner));
    chainError = null;
  } catch (e) {
    chainState = null;
    chainError = describeChainError(e).message;
  }
}

async function loadResults() {
  try {
    chainResults = await readResults(getSessionContract(getReadProvider()));
  } catch (e) {
    chainResults = null;
  }
}

async function loadDb() {
  const { data, error } = await sb.from("tb_sesi_voting").select("*").eq("id", 1).single();
  if (error || !data) {
    dbState = null;
    dbError = error ? error.message : "Baris status sesi tidak ditemukan. Jalankan schema.sql terbaru.";
  } else {
    dbState = data;
    dbError = null;
  }
}

async function loadKandidatDb() {
  const { data, error } = await sb
    .from("tb_kandidat")
    .select("nomor_paslon, nama_ketua")
    .order("nomor_paslon", { ascending: true });
  kandidatDb = error ? null : data || [];
}

async function loadKontrakRow() {
  const { data, error } = await sb.from("tb_pengaturan_kontrak").select("*").eq("id", 1).maybeSingle();
  kontrakFiturAktif = !error; // error = tabel belum dibuat (patch belum dijalankan)
  kontrakRow = error ? null : data || null;
}

async function loadRelayerRow() {
  const { data, error } = await sb.from("tb_status_relayer").select("*").eq("id", 1).single();
  relayerRow = error || !data ? null : data;
}

// Ringkasan jumlah (tanpa identitas): mahasiswa yang sudah memilih & isi antrian.
async function fetchSummary() {
  const { data, error } = await sb.rpc("fn_ringkasan_suara");
  if (error || !data) return null;
  return {
    sudahMemilih: Number(data.sudah_memilih),
    menunggu: Number(data.menunggu),
    diproses: Number(data.diproses),
    terkirim: Number(data.terkirim),
  };
}

function needsSync(chain, db) {
  // 'menutup' hanya ada di database (tahap peralihan); blockchain masih 'berlangsung'.
  const statusSelaras =
    db.status === chain.statusKey || (db.status === "menutup" && chain.statusKey === "berlangsung");
  return !statusSelaras || (chain.openedAt && !db.dibuka_pada) || (chain.closedAt && !db.ditutup_pada);
}

// Salinan di database mengikuti blockchain (bukan sebaliknya).
async function autoSync() {
  syncError = null;
  if (!chainState || !dbState || !needsSync(chainState, dbState)) return;
  try {
    dbState = await syncDatabase(chainState, null, null);
    showToast("info", "Status database disinkronkan dengan blockchain.");
  } catch (e) {
    syncError = e.message;
  }
}

async function syncDatabase(state, txHash, action) {
  const payload = { status: state.statusKey, diperbarui_pada: new Date().toISOString() };
  if (state.openedAt) {
    payload.dibuka_pada = unixToIso(state.openedAt);
    payload.dibuka_oleh = state.openedBy;
  }
  if (state.closedAt) {
    payload.ditutup_pada = unixToIso(state.closedAt);
    payload.ditutup_oleh = state.closedBy;
  }
  if (txHash && action === "open") payload.dibuka_tx = txHash;
  if (txHash && action === "close") payload.ditutup_tx = txHash;

  const { data, error } = await sb.from("tb_sesi_voting").update(payload).eq("id", 1).select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Database menolak pembaruan. Pastikan Anda login sebagai admin dan schema.sql terbaru sudah dijalankan.");
  }
  return data[0];
}

// Mengubah HANYA status di database (dipakai untuk tahap 'menutup' dan pembatalannya).
async function setDbStatus(status) {
  const { data, error } = await sb
    .from("tb_sesi_voting")
    .update({ status, diperbarui_pada: new Date().toISOString() })
    .eq("id", 1)
    .select();
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("Database menolak pembaruan. Pastikan Anda login sebagai admin.");
  }
  dbState = data[0];
}

// ---------------------------------------------------------
// Tampilan
// ---------------------------------------------------------
function setBadge(state, label) {
  el.badge.dataset.state = state;
  el.badge.textContent = label;
}

function sameAddress(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Penutupan sudah dimulai di database tetapi transaksi penutupan belum selesai di blockchain
function closingInProgress() {
  return !!(dbState && dbState.status === "menutup" && chainState && chainState.status === 1);
}

function relativeTime(iso) {
  const detik = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (detik < 60) return `${detik} detik lalu`;
  if (detik < 3600) return `${Math.round(detik / 60)} menit lalu`;
  return `${Math.round(detik / 3600)} jam lalu`;
}

function render() {
  // Badge status
  if (chainError) setBadge("error", "Tidak dapat dibaca");
  else if (closingInProgress()) setBadge("closing", "Sedang ditutup");
  else if (chainState) setBadge(["idle", "open", "closed"][chainState.status], STATUS_LABEL[chainState.status]);

  // Rincian
  el.openedInfo.textContent =
    chainState && chainState.openedAt
      ? `${formatChainTime(chainState.openedAt)} oleh ${shortAddress(chainState.openedBy)}`
      : "—";
  el.closedInfo.textContent =
    chainState && chainState.closedAt
      ? `${formatChainTime(chainState.closedAt)} oleh ${shortAddress(chainState.closedBy)}`
      : "—";
  el.ownerInfo.textContent = chainState ? chainState.owner : "—";

  // Salinan database
  if (dbError) el.dbInfo.textContent = `Tidak dapat dibaca: ${dbError}`;
  else if (syncError) el.dbInfo.textContent = `Belum sinkron: ${syncError}`;
  else if (dbState && chainState) {
    el.dbInfo.textContent = `${DB_LABEL[dbState.status] || dbState.status} — sinkron dengan blockchain`;
  } else if (dbState) el.dbInfo.textContent = DB_LABEL[dbState.status] || dbState.status;
  else el.dbInfo.textContent = "—";

  renderWallet();

  const gate = actionGate();
  const closing = closingInProgress();
  el.btnOpen.disabled = !(gate.canAct && chainState.status === 0);
  el.btnClose.disabled = !(gate.canAct && chainState.status === 1);
  el.btnClose.textContent = closing ? "Lanjutkan Penutupan" : "Tutup Sesi Voting";
  el.btnCancelClose.classList.toggle("hidden", !closing);
  el.btnCancelClose.disabled = busy;
  el.hint.textContent = gate.hint;

  renderRelayerPanel();
  renderKontrakPanel();
  renderResults();
}

// Syarat dasar untuk aksi yang butuh wallet pemilik kontrak
function walletGate() {
  if (blockchainConfigProblem()) {
    return { ok: false, hint: "Selesaikan pengaturan kontrak terlebih dahulu (lihat pesan di atas)." };
  }
  if (chainError) {
    return { ok: false, hint: 'Status sesi belum dapat dibaca dari blockchain. Klik "Muat ulang".' };
  }
  if (!chainState) return { ok: false, hint: "Memuat status sesi..." };
  if (busy) return { ok: false, hint: "Aksi sedang diproses..." };
  if (!wallet) return { ok: false, hint: "Hubungkan MetaMask untuk mengelola sesi." };
  if (wallet.chainId !== BLOCKCHAIN.CHAIN_ID) {
    return { ok: false, hint: `MetaMask berada di jaringan lain. Ganti ke ${BLOCKCHAIN.CHAIN_NAME}.` };
  }
  if (!sameAddress(wallet.address, chainState.owner)) {
    return {
      ok: false,
      hint: `Wallet yang terhubung bukan pemilik kontrak. Pilih akun ${shortAddress(chainState.owner)} di MetaMask.`,
    };
  }
  return { ok: true, hint: "" };
}

function actionGate() {
  if (!blockchainConfigProblem() && !chainError && chainState && chainState.status === 2) {
    return {
      canAct: false,
      hint: "Sesi sudah ditutup secara permanen dan tidak dapat dibuka kembali. Untuk pemilihan baru, deploy kontrak baru.",
    };
  }
  const gate = walletGate();
  if (!gate.ok) return { canAct: false, hint: gate.hint };

  if (chainState.status === 0) {
    if (kandidatDb && kandidatDb.length === 0) {
      return {
        canAct: false,
        hint: "Belum ada kandidat. Tambahkan kandidat di menu Kandidat sebelum memulai sesi.",
      };
    }
    return { canAct: true, hint: 'Sesi belum dimulai. Klik "Mulai Sesi Voting" untuk membuka pemilihan.' };
  }
  if (closingInProgress()) {
    return {
      canAct: true,
      hint: 'Penutupan sedang berlangsung: penerimaan suara sudah dihentikan. Klik "Lanjutkan Penutupan" untuk menyelesaikannya, atau "Batalkan penutupan" untuk membuka kembali.',
    };
  }
  return {
    canAct: true,
    hint: 'Sesi sedang berlangsung. Klik "Tutup Sesi Voting" jika pemilihan sudah selesai.',
  };
}

function chip(text, kind) {
  const span = document.createElement("span");
  span.className = `wallet-chip wallet-chip-${kind}`;
  span.textContent = text;
  return span;
}

function renderWallet() {
  el.walletChips.innerHTML = "";

  if (!window.ethereum) {
    el.walletAddress.textContent = "MetaMask tidak terdeteksi";
    el.walletHelp.textContent = "Pasang ekstensi MetaMask di browser Anda, lalu muat ulang halaman ini. ";
    const a = document.createElement("a");
    a.href = "https://metamask.io/download/";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Unduh MetaMask";
    el.walletHelp.appendChild(a);
    el.btnConnect.classList.add("hidden");
    el.btnSwitch.classList.add("hidden");
    return;
  }

  if (!wallet) {
    el.walletAddress.textContent = "Belum terhubung";
    el.btnConnect.classList.remove("hidden");
    el.btnSwitch.classList.add("hidden");
    return;
  }

  el.walletAddress.textContent = wallet.address;
  el.btnConnect.classList.add("hidden");

  const rightNetwork = wallet.chainId === BLOCKCHAIN.CHAIN_ID;
  el.walletChips.appendChild(
    chip(rightNetwork ? `Jaringan: ${BLOCKCHAIN.CHAIN_NAME}` : `Jaringan salah (ID ${wallet.chainId})`, rightNetwork ? "ok" : "bad")
  );
  if (chainState) {
    const isOwner = sameAddress(wallet.address, chainState.owner);
    el.walletChips.appendChild(chip(isOwner ? "Pemilik kontrak" : "Bukan pemilik kontrak", isOwner ? "ok" : "bad"));
  }
  el.btnSwitch.textContent = `Ganti ke ${BLOCKCHAIN.CHAIN_NAME}`;
  el.btnSwitch.classList.toggle("hidden", rightNetwork);
}

// Apakah sesi voting di database sedang menerima suara / sedang ditutup?
function sesiBerjalanDb() {
  return !!dbState && (dbState.status === "berlangsung" || dbState.status === "menutup");
}

// Detak jantung relayer masih baru dan tanpa error?
function heartbeatSegar() {
  if (!relayerRow || !relayerRow.terakhir_aktif) return false;
  const umur = Date.now() - new Date(relayerRow.terakhir_aktif).getTime();
  return umur <= RELAYER_STALE_MS && !relayerRow.error_terakhir;
}

// Apakah relayer terlihat sehat? -> { state: "ok" | "bad" | "idle", text }
// Relayer otomatis hanya dipanggil saat sesi berlangsung/menutup, jadi di luar itu detak
// jantungnya wajar lama; statusnya "siaga", bukan "tidak aktif".
function relayerHealth() {
  if (!relayerRow || !relayerRow.terakhir_aktif) {
    return {
      state: "bad",
      text: 'Belum pernah diperiksa atau dijalankan. Klik "Periksa relayer" (panduan: supabase/PANDUAN_EDGE_FUNCTION.md).',
    };
  }
  const umur = Date.now() - new Date(relayerRow.terakhir_aktif).getTime();
  const parts = [];
  let state = "ok";

  if (relayerRow.aktif === false) {
    state = "bad";
    parts.push("DIJEDA — suara tidak dikirim ke blockchain sampai relayer dilanjutkan");
  } else if (sesiBerjalanDb()) {
    if (umur > RELAYER_STALE_MS) {
      state = "bad";
      parts.push(`Tidak aktif — terakhir terdeteksi ${relativeTime(relayerRow.terakhir_aktif)}`);
    } else {
      parts.push(`Aktif (terdeteksi ${relativeTime(relayerRow.terakhir_aktif)})`);
    }
  } else {
    state = "idle";
    parts.push(`Siaga — aktif otomatis saat sesi berlangsung (pemeriksaan terakhir ${relativeTime(relayerRow.terakhir_aktif)})`);
  }
  if (relayerRow.terakhir_kirim) parts.push(`terakhir kirim ${relativeTime(relayerRow.terakhir_kirim)}`);
  if (relayerRow.alamat_relayer && chainState && !sameAddress(relayerRow.alamat_relayer, chainState.relayer)) {
    state = "bad";
    parts.push(`PERINGATAN: wallet yang berjalan (${shortAddress(relayerRow.alamat_relayer)}) berbeda dengan relayer terdaftar`);
  }
  if (relayerRow.error_terakhir) {
    state = "bad";
    parts.push(`Error: ${relayerRow.error_terakhir}`);
  }
  return { state, text: parts.join(" · ") };
}

// Pemeriksaan: setiap suara di blockchain berasal dari satu mahasiswa yang tercatat memilih.
//   sudahMemilih(sebelum) - antrian(sebelum) <= suara di blockchain <= sudahMemilih(sesudah)
// (ringkasan dibaca sebelum dan sesudah blockchain agar perubahan di tengah pembacaan tidak
// menimbulkan peringatan palsu)
function verifyConsistency() {
  if (!chainState || !summaryBefore || !summaryAfter) return null;
  const x = chainState.totalVotes;
  const batasBawah = summaryBefore.sudahMemilih - (summaryBefore.menunggu + summaryBefore.diproses);
  return x >= batasBawah && x <= summaryAfter.sudahMemilih;
}

function renderRelayerPanel() {
  el.relayerChain.textContent = chainState ? chainState.relayer : "—";

  const health = relayerHealth();
  el.relayerLive.textContent = health.text;
  el.relayerLive.dataset.state = health.state;

  const ringkasan = summaryAfter || summaryBefore;
  el.queueInfo.textContent = ringkasan
    ? `${ringkasan.menunggu} menunggu · ${ringkasan.diproses} diproses · ${ringkasan.terkirim} terkirim`
    : "—";
  el.chainVotes.textContent = chainState ? String(chainState.totalVotes) : "—";
  el.votedInfo.textContent = summaryAfter ? String(summaryAfter.sudahMemilih) : "—";

  const konsisten = verifyConsistency();
  if (konsisten === null) {
    el.verifyInfo.textContent = "—";
    el.verifyInfo.dataset.state = "idle";
  } else if (konsisten) {
    el.verifyInfo.textContent = "Konsisten: jumlah suara di blockchain sesuai dengan jumlah mahasiswa yang memilih dan isi antrian.";
    el.verifyInfo.dataset.state = "ok";
  } else {
    el.verifyInfo.textContent =
      "TIDAK KONSISTEN: jumlah suara di blockchain tidak sesuai dengan jumlah mahasiswa yang memilih. Jika ini data uji lama, reset status memilih (lihat PANDUAN_DEPLOY.md); jika bukan, selidiki sebelum menutup sesi.";
    el.verifyInfo.dataset.state = "bad";
  }

  renderRelayerControls();
  renderRelayerForm();
}

function renderRelayerForm() {
  const value = el.relayerInput.value.trim();
  let hint = DEFAULT_RELAYER_HINT;
  let valid = false;

  if (chainState && chainState.status === 2) {
    hint = "Sesi sudah ditutup; relayer tidak dapat diganti lagi.";
  } else {
    const gate = walletGate();
    if (!gate.ok) hint = gate.hint;
    else if (!value) hint = DEFAULT_RELAYER_HINT;
    else if (!ethers.isAddress(value)) hint = "Alamat tidak valid. Periksa kembali (diawali 0x, 42 karakter).";
    else if (sameAddress(value, chainState.relayer)) hint = "Alamat ini sudah menjadi relayer terdaftar.";
    else {
      valid = true;
      hint = 'Alamat valid. Klik "Daftarkan relayer" untuk menggantinya (perlu konfirmasi MetaMask).';
    }
  }
  el.relayerHint.textContent = hint;
  el.btnSetRelayer.disabled = !valid;
}

// Hasil akhir dibaca dari kontrak; nama paslon dari database
function renderResults() {
  const tampil = !!(chainState && chainState.status === 2 && chainResults);
  el.resultsPanel.classList.toggle("hidden", !tampil);
  if (!tampil) return;

  const total = chainResults.counts.reduce((a, b) => a + b, 0);
  const tertinggi = Math.max(...chainResults.counts);
  const pemenang = chainResults.counts.filter((c) => c === tertinggi).length === 1 && tertinggi > 0;

  el.resultsBody.innerHTML = "";
  chainResults.numbers.forEach((nomor, i) => {
    const k = (kandidatDb || []).find((x) => x.nomor_paslon === nomor);
    const jumlah = chainResults.counts[i];
    const persen = total > 0 ? ((jumlah / total) * 100).toFixed(1) : "0.0";

    const tr = document.createElement("tr");
    if (pemenang && jumlah === tertinggi) tr.className = "row-top";

    const cells = [
      String(nomor).padStart(2, "0"),
      k ? k.nama_ketua : "(data kandidat tidak ditemukan)",
      String(jumlah),
      `${persen}%`,
    ];
    cells.forEach((text, idx) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (idx === 0) td.className = "strong";
      tr.appendChild(td);
    });
    el.resultsBody.appendChild(tr);
  });

  el.resultsNote.textContent =
    `Total ${total} suara, dihitung langsung oleh smart contract dan tidak dapat diubah.` +
    (!pemenang && total > 0 ? " Perolehan tertinggi sama (seri)." : "");
}

// ---------------------------------------------------------
// Wallet (MetaMask)
// ---------------------------------------------------------
function attachWalletListeners() {
  if (walletListenersAttached || !window.ethereum || !window.ethereum.on) return;
  walletListenersAttached = true;
  window.ethereum.on("accountsChanged", () => refreshWallet());
  window.ethereum.on("chainChanged", () => refreshWallet());
}

async function refreshWallet() {
  if (!window.ethereum) {
    wallet = null;
    render();
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum, "any");
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts || accounts.length === 0) {
      wallet = null;
    } else {
      const network = await provider.getNetwork();
      wallet = { provider, address: ethers.getAddress(accounts[0]), chainId: Number(network.chainId) };
    }
  } catch (e) {
    wallet = null;
  }
  render();
}

// Menyambung kembali wallet yang sudah pernah diizinkan, tanpa memunculkan popup MetaMask
async function restoreWallet() {
  if (!window.ethereum) return;
  attachWalletListeners();
  await refreshWallet();
}

async function connectWallet() {
  if (!window.ethereum) {
    showToast("error", "MetaMask tidak terdeteksi di browser ini.");
    render();
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    attachWalletListeners();
    await refreshWallet();
    if (wallet) showToast("success", `Wallet terhubung: ${shortAddress(wallet.address)}`);
  } catch (e) {
    const d = describeChainError(e);
    showToast(d.type, d.type === "info" ? "Koneksi wallet dibatalkan." : d.message);
  }
}

async function switchNetwork() {
  const chainIdHex = "0x" + BLOCKCHAIN.CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
  } catch (e) {
    const code = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
    if (code === 4902) {
      // Jaringan belum ada di MetaMask: tambahkan lalu pindah
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: BLOCKCHAIN.CHAIN_NAME,
              rpcUrls: [BLOCKCHAIN.RPC_URL],
              nativeCurrency: BLOCKCHAIN.NATIVE_CURRENCY,
              blockExplorerUrls: BLOCKCHAIN.EXPLORER_URL ? [BLOCKCHAIN.EXPLORER_URL] : undefined,
            },
          ],
        });
      } catch (e2) {
        const d = describeChainError(e2);
        showToast(d.type, d.type === "info" ? "Penambahan jaringan dibatalkan." : d.message);
        return;
      }
    } else {
      const d = describeChainError(e);
      showToast(d.type, d.type === "info" ? "Pergantian jaringan dibatalkan." : d.message);
      return;
    }
  }
  await refreshWallet();
}

// ---------------------------------------------------------
// Popup konfirmasi
// ---------------------------------------------------------
function openConfirm(action) {
  const button =
    action === "open" ? el.btnOpen : action === "close" ? el.btnClose : action === "kontrak" ? el.btnSetKontrak : el.btnSetRelayer;
  if (busy || button.disabled) return;

  const cfg = ACTIONS[action];
  let text = cfg.text;
  const points = cfg.points.slice();

  if (action === "open") {
    // Nomor paslon dikunci permanen di kontrak saat sesi dibuka
    const daftar = kandidatDb || [];
    if (daftar.length === 0) {
      showToast("error", "Belum ada kandidat. Tambahkan kandidat di menu Kandidat dulu.");
      return;
    }
    pendingNumbers = daftar.map((k) => k.nomor_paslon);
    points.unshift(
      `Kandidat yang akan dikunci: ${daftar.map((k) => `Paslon ${k.nomor_paslon}`).join(", ")}. Setelah sesi dibuka, data kandidat tidak dapat diubah atau dihapus.`
    );
  }

  if (action === "close" && closingInProgress()) {
    text = "Penutupan sudah dimulai (penerimaan suara baru sudah dihentikan). Anda akan melanjutkannya.";
  }

  if (action === "kontrak") {
    const alamat = ethers.getAddress(el.kontrakInput.value.trim());
    const reset = el.kontrakReset.checked;
    pendingKontrak = { alamat, reset };
    text = `Anda akan mengatur ${alamat} sebagai kontrak pemilihan yang aktif.`;
    points.length = 0;
    points.push("Alamat ini dipakai halaman web (halaman depan dan Sesi Voting) dan relayer otomatis.");
    if (reset) {
      points.push(
        "Data pemilihan sebelumnya dikosongkan: antrian suara dihapus, status \"sudah memilih\" semua mahasiswa direset, dan status sesi kembali ke \"Belum dimulai\". Akun mahasiswa dan data kandidat tetap.",
        "Hasil di kontrak lama tetap tersimpan di blockchain, tetapi salinan antrian di database hilang. Simpan hasil pemilihan sebelumnya lebih dulu bila perlu."
      );
    } else {
      points.push("Data pemilihan yang ada TIDAK diubah.");
    }
    points.push("Sebelum diterapkan, kontrak diperiksa di blockchain" + (reset ? " (harus ada dan statusnya masih \"Belum dimulai\")." : " (harus ada)."));
    cfg.danger = reset;
    cfg.confirmClass = reset ? "btn-danger-solid" : "btn-primary";
    cfg.confirmLabel = reset ? "Ya, Terapkan dan Kosongkan Data" : "Ya, Terapkan Alamat";
    cfg.warning = reset ? "Penghapusan data pemilihan lama tidak dapat dibatalkan." : "Pastikan alamat kontrak sudah benar.";
  }

  if (action === "relayer") {
    pendingRelayerAddress = ethers.getAddress(el.relayerInput.value.trim());
    text = `Anda akan mendaftarkan ${pendingRelayerAddress} sebagai relayer.`;
  }

  pendingAction = action;
  lastFocusedEl = document.activeElement;

  el.title.textContent = cfg.title;
  el.text.textContent = text;
  el.points.innerHTML = "";
  points.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p;
    el.points.appendChild(li);
  });
  el.warning.textContent = cfg.warning;
  el.warning.classList.toggle("danger", cfg.danger);
  el.btnConfirm.textContent = cfg.confirmLabel;
  el.btnConfirm.className = cfg.confirmClass;
  el.btnConfirm.disabled = false;

  el.viewConfirm.classList.remove("hidden");
  el.viewProgress.classList.add("hidden");
  el.overlay.classList.remove("hidden");
  el.btnCancel.focus(); // fokus awal di aksi yang aman, bukan di tombol eksekusi
}

function closeModal() {
  if (busy) return;
  el.overlay.classList.add("hidden");
  pendingAction = null;
  if (lastFocusedEl) lastFocusedEl.focus();
}

// ---------------------------------------------------------
// Progres & eksekusi aksi
// ---------------------------------------------------------
function renderSteps(steps) {
  el.steps.innerHTML = "";
  steps.forEach((name) => {
    const li = document.createElement("li");
    li.dataset.step = name;
    li.dataset.state = "pending";
    li.textContent = STEP_LABEL[name];
    el.steps.appendChild(li);
  });
}

function setStep(name, state) {
  if (state === "active") currentStep = name;
  const li = el.steps.querySelector(`[data-step="${name}"]`);
  if (li) li.dataset.state = state;
}

function setNote(text) {
  el.note.textContent = text || "";
  el.note.classList.toggle("hidden", !text);
}

function showResult(type, message, txHash) {
  el.result.className = `status-msg ${type}`;
  el.result.textContent = message;
  if (txHash && BLOCKCHAIN.EXPLORER_URL) {
    const a = document.createElement("a");
    a.href = `${BLOCKCHAIN.EXPLORER_URL}/tx/${txHash}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Lihat transaksi";
    el.result.append(" ", a);
  }
  el.btnClose2.classList.remove("hidden");
  el.btnClose2.focus();
}

function showProgress(cfg) {
  el.viewConfirm.classList.add("hidden");
  el.viewProgress.classList.remove("hidden");
  el.progressTitle.textContent = cfg.progressTitle;
  el.result.className = "status-msg hidden";
  el.btnClose2.classList.add("hidden");
  el.btnAbort.classList.add("hidden");
  el.btnAbort.disabled = false;
  el.btnRetry.classList.add("hidden");
  pendingWatch = null;
  setNote("");
  renderSteps(cfg.steps);
  currentStep = null;
}

function buildCall(contract, action) {
  if (action === "open") return { method: contract.openSession, args: [pendingNumbers] };
  if (action === "close") return { method: contract.closeSession, args: [] };
  return { method: contract.setRelayer, args: [pendingRelayerAddress] };
}

// Membaca status terbaru lewat provider wallet (agar tidak tertinggal dari RPC publik)
async function readBack(cfg) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await readSessionState(getSessionContract(wallet.provider));
    if (cfg.confirmState(state)) return state;
    await sleep(1000);
  }
  throw new Error('Transaksi terkonfirmasi, tetapi status terbaru belum terbaca. Klik "Muat ulang" beberapa saat lagi.');
}

// Tidur yang bisa dibatalkan (untuk tombol "Batalkan penutupan")
async function sleepAbortable(ms) {
  const mulai = Date.now();
  while (Date.now() - mulai < ms) {
    if (abortRequested) return;
    await sleep(250);
  }
}

// ---------------------------------------------------------
// Kontrak pemilihan (alamat kontrak aktif + pemilihan baru)
// ---------------------------------------------------------
function formatIso(iso) {
  const d = new Date(iso);
  const tanggal = d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Makassar" });
  const jam = d
    .toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Makassar" })
    .replace(":", ".");
  return `${tanggal}, ${jam} WITA`;
}

function renderKontrakPanel() {
  const alamat = BLOCKCHAIN.CONTRACT_ADDRESS;
  el.kontrakAktif.textContent = alamat || "Belum diatur";
  el.contractInfo.textContent = alamat || "Belum diatur";

  const sumber = BLOCKCHAIN.ADDRESS_SOURCE;
  el.kontrakSumber.textContent =
    sumber === "database"
      ? "Database (diatur dari halaman ini)"
      : sumber === "file"
        ? "Cadangan dari js/Blockchainconfig.js (belum diatur di database)"
        : sumber === "error"
          ? `Gagal dibaca dari database: ${BLOCKCHAIN.ADDRESS_ERROR}`
          : "Belum diatur";
  el.kontrakDiubah.textContent = kontrakRow && kontrakRow.diperbarui_pada ? formatIso(kontrakRow.diperbarui_pada) : "—";

  const nilai = el.kontrakInput.value.trim();
  const status = dbState ? dbState.status : null;
  const sesiAktif = status === "berlangsung" || status === "menutup";
  const reset = el.kontrakReset.checked;

  let hint = DEFAULT_KONTRAK_HINT;
  let valid = false;
  if (!kontrakFiturAktif) {
    hint = "Fitur ini belum aktif: jalankan supabase/patch_kontrak_dinamis.sql di SQL Editor Supabase.";
  } else if (!dbState) {
    hint = "Memuat status sesi...";
  } else if (sesiAktif) {
    hint = "Alamat kontrak tidak dapat diganti saat sesi sedang berlangsung atau sedang ditutup.";
  } else if (busy) {
    hint = "Aksi sedang diproses...";
  } else if (!nilai) {
    hint = DEFAULT_KONTRAK_HINT;
  } else if (!ethers.isAddress(nilai)) {
    hint = "Alamat tidak valid. Periksa kembali (diawali 0x, 42 karakter).";
  } else if (sameAddress(nilai, alamat) && !reset) {
    hint = "Alamat ini sudah menjadi kontrak aktif.";
  } else {
    valid = true;
    hint = reset
      ? 'Alamat valid. Klik "Terapkan" untuk memulai pemilihan baru dengan kontrak ini (data pemilihan lama dikosongkan).'
      : 'Alamat valid. Klik "Terapkan" untuk mengganti alamat kontrak tanpa mengubah data pemilihan.';
  }

  const terkunci = !kontrakFiturAktif || !dbState || sesiAktif || busy;
  el.kontrakInput.disabled = terkunci;
  el.kontrakReset.disabled = terkunci;
  el.btnSetKontrak.disabled = !valid;
  el.kontrakHint.textContent = hint;
}

// Memeriksa kontrak di blockchain SEBELUM diterapkan, supaya salah ketik tidak membuat
// web dan relayer menunjuk ke alamat yang tidak ada.
async function periksaKontrakBaru(alamat, reset) {
  const provider = getReadProvider();
  let kode;
  try {
    kode = await provider.getCode(alamat);
  } catch (_) {
    throw new Error("Tidak dapat menghubungi jaringan blockchain untuk memeriksa kontrak. Coba lagi beberapa saat lagi.");
  }
  if (!kode || kode === "0x") {
    throw new Error(`Tidak ada kontrak di alamat itu pada jaringan ${BLOCKCHAIN.CHAIN_NAME}. Periksa alamat dan jaringannya.`);
  }
  let state;
  try {
    state = await readSessionState(getSessionContract(provider, alamat));
  } catch (_) {
    throw new Error("Alamat itu bukan kontrak VotingSession yang dikenali aplikasi ini.");
  }
  if (reset && state.status !== 0) {
    throw new Error(
      "Kontrak ini sudah dibuka atau ditutup. Untuk pemilihan baru, deploy kontrak baru yang statusnya masih \"Belum dimulai\"."
    );
  }
  return state;
}

async function terapkanKontrak() {
  const { alamat, reset } = pendingKontrak;

  setStep("kontrak", "active");
  const state = await periksaKontrakBaru(alamat, reset);
  setStep("kontrak", "done");

  setStep("db", "active");
  const { error } = await sb.rpc("fn_set_kontrak", {
    p_alamat: alamat,
    p_reset: reset,
    p_wallet: wallet ? wallet.address : null,
  });
  if (error) throw new Error(error.message);
  setStep("db", "done");
  currentStep = null;

  // Mulai sekarang web memakai kontrak baru
  BLOCKCHAIN.CONTRACT_ADDRESS = alamat;
  BLOCKCHAIN.ADDRESS_SOURCE = "database";
  BLOCKCHAIN.ADDRESS_ERROR = null;
  chainState = null;
  chainError = null;
  chainResults = null;
  syncError = null;
  el.configAlert.className = "status-msg hidden";
  el.configAlert.textContent = "";
  el.kontrakInput.value = "";
  pendingKontrak = null;

  busy = false;
  if (!liveStarted) {
    await restoreWallet();
    startLiveRefresh();
  }
  await loadAll();

  let pesan = reset
    ? "Kontrak baru diterapkan dan data pemilihan sebelumnya dikosongkan. Langkah berikutnya: klik \"Periksa relayer\", lalu \"Mulai Sesi Voting\"."
    : "Alamat kontrak diperbarui. Data pemilihan tidak diubah.";
  if (relayerRow && relayerRow.alamat_relayer && !sameAddress(relayerRow.alamat_relayer, state.relayer)) {
    pesan += ` PERHATIAN: relayer yang terdaftar di kontrak baru (${shortAddress(state.relayer)}) berbeda dengan wallet relayer yang berjalan (${shortAddress(relayerRow.alamat_relayer)}). Daftarkan wallet relayer lewat panel "Ganti relayer" sebelum membuka sesi.`;
  }
  showResult("success", pesan);
  showToast("success", "Kontrak pemilihan diterapkan.");
}

// ---------------------------------------------------------
// Relayer otomatis (Edge Function "relayer")
// ---------------------------------------------------------
// Memanggil Edge Function sebagai admin. aksi: "cek" | "siklus" | "paksa".
// Melempar Error dengan properti `unreachable` bila fungsinya tidak terpasang/tidak terjangkau.
async function callRelayer(aksi) {
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (!session) throw new Error("Sesi login admin tidak ditemukan. Login ulang lalu coba lagi.");

  let res;
  try {
    res = await fetch(RELAYER_FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ aksi }),
    });
  } catch (_) {
    const err = new Error("Edge Function relayer tidak dapat dihubungi (belum di-deploy, atau koneksi bermasalah).");
    err.unreachable = true;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error("Edge Function relayer belum di-deploy di Supabase.");
    err.unreachable = true;
    throw err;
  }

  let hasil = null;
  try {
    hasil = await res.json();
  } catch (_) {
    /* bukan JSON */
  }
  if (res.status === 401) throw new Error("Edge Function menolak akses. Pastikan Anda login sebagai admin.");
  if (!hasil) throw new Error(`Edge Function relayer mengembalikan HTTP ${res.status}.`);
  return hasil;
}

// Tahap awal "Mulai Sesi Voting": pastikan relayer siap SEBELUM sesi dibuka, supaya suara
// pertama tidak tertahan di antrian tanpa ada yang mengirim.
async function prepareOpen() {
  setStep("relayer", "active");
  await loadRelayerRow();
  if (relayerRow && relayerRow.aktif === false) {
    throw new Error("Relayer sedang dijeda. Nyalakan kembali saklar relayer di panel Relayer, lalu coba lagi.");
  }

  let hasil;
  try {
    hasil = await callRelayer("cek");
  } catch (e) {
    if (!e.unreachable) throw e;
    // Edge Function belum terpasang: tetap izinkan relayer manual (npm start) selama
    // detak jantungnya segar dan tanpa error.
    if (heartbeatSegar()) {
      setStep("relayer", "done");
      return;
    }
    throw new Error(
      `${e.message} Pasang Edge Function relayer (lihat supabase/PANDUAN_EDGE_FUNCTION.md), atau jalankan relayer manual (npm start), lalu coba lagi.`
    );
  }
  await loadRelayerRow();
  render();
  if (!hasil.ok) throw new Error(`Relayer belum siap: ${hasil.pesan}`);
  setStep("relayer", "done");
}

function renderRelayerControls() {
  const ada = !!relayerRow;
  const aktif = ada ? relayerRow.aktif !== false : true;
  const berjalan = sesiBerjalanDb();

  el.relayerToggle.checked = aktif;
  el.relayerToggle.disabled = !ada || busy || relayerBusy;
  el.relayerToggleLabel.textContent = aktif ? "Relayer otomatis aktif" : "Relayer dijeda";
  el.btnRelayerCek.disabled = busy || relayerBusy;
  el.btnRelayerKirim.disabled = busy || relayerBusy || !berjalan || !aktif;

  let hint;
  if (relayerCtlMessage) hint = relayerCtlMessage;
  else if (!aktif) {
    hint = "Relayer sedang dijeda. Suara tetap aman di antrian, tetapi tidak dikirim ke blockchain sampai saklar dinyalakan lagi.";
  } else if (!berjalan) {
    hint = 'Siaga: relayer otomatis bekerja saat sesi voting berlangsung. Klik "Periksa relayer" untuk memastikan semuanya siap sebelum memulai sesi.';
  } else {
    hint = 'Relayer otomatis berjalan tiap menit. "Kirim sekarang" mengirim antrian saat ini juga, tanpa menunggu selang waktu dan batas minimal batch.';
  }
  el.relayerCtlHint.textContent = hint;
}

async function runRelayerControl(aksi, labelBusy, button) {
  if (busy || relayerBusy) return;
  relayerBusy = true;
  relayerCtlMessage = "";
  const labelAwal = button.textContent;
  button.textContent = labelBusy;
  renderRelayerControls();
  try {
    const hasil = await callRelayer(aksi);
    relayerCtlMessage = hasil.pesan || "";
    showToast(hasil.ok ? "success" : "error", hasil.pesan || (hasil.ok ? "Selesai." : "Gagal."));
  } catch (e) {
    relayerCtlMessage = e.message;
    showToast("error", e.message);
  } finally {
    button.textContent = labelAwal;
    relayerBusy = false;
    try {
      await loadLive();
    } catch (_) {
      /* tampilan diperbarui pada siklus berikutnya */
    }
    render();
  }
}

async function toggleRelayerAktif() {
  if (busy || relayerBusy) return;
  const aktif = el.relayerToggle.checked;
  if (!aktif && sesiBerjalanDb()) {
    const lanjut = window.confirm(
      "Sesi voting sedang berlangsung. Jika relayer dijeda, suara mahasiswa tidak dikirim ke blockchain dan sesi tidak bisa ditutup sampai relayer dilanjutkan. Jeda sekarang?"
    );
    if (!lanjut) {
      el.relayerToggle.checked = true;
      return;
    }
  }
  relayerBusy = true;
  relayerCtlMessage = "";
  renderRelayerControls();
  try {
    const { error } = await sb.rpc("fn_set_relayer_aktif", { p_aktif: aktif });
    if (error) throw new Error(error.message);
    showToast("success", aktif ? "Relayer dilanjutkan." : "Relayer dijeda.");
  } catch (e) {
    relayerCtlMessage = `Gagal mengubah pengaturan relayer: ${e.message} (sudah menjalankan supabase/patch_relayer_otomatis.sql?)`;
    showToast("error", "Gagal mengubah pengaturan relayer.");
  } finally {
    relayerBusy = false;
    await loadRelayerRow();
    render();
  }
}

// Tahap penutupan: hentikan suara baru di database, lalu tunggu relayer mengosongkan antrian.
async function prepareClose() {
  setStep("stop", "active");
  if (!dbState || dbState.status === "berlangsung") await setDbStatus("menutup");
  render();
  setStep("stop", "done");

  setStep("flush", "active");
  abortRequested = false;
  el.btnAbort.classList.remove("hidden");
  let terakhirPicu = 0;
  try {
    for (; ;) {
      if (abortRequested) throw { aborted: true };

      // Minta relayer otomatis mengirim sisa suara SEKARANG (tidak menunggu penjadwal).
      // Hasilnya tidak ditunggu; jika Edge Function tidak terpasang (relayer manual), diabaikan.
      if (Date.now() - terakhirPicu > 30_000) {
        terakhirPicu = Date.now();
        callRelayer("siklus").catch(() => { });
      }

      let sisa = null;
      try {
        const s = await fetchSummary();
        if (s) sisa = s.menunggu + s.diproses;
        await loadRelayerRow();
      } catch (e) {
        sisa = null;
      }

      if (sisa === 0) break;

      const health = relayerHealth();
      let pesan =
        sisa === null
          ? "Gagal membaca isi antrian, mencoba lagi..."
          : `Menunggu ${sisa} suara terkirim ke blockchain oleh relayer...`;
      if (health.state === "bad") {
        pesan += " Relayer tampak tidak aktif, dijeda, atau bermasalah: periksa panel Relayer di bawah, atau batalkan penutupan.";
      }
      setNote(pesan);

      await sleepAbortable(QUEUE_POLL_MS);
    }
  } finally {
    el.btnAbort.classList.add("hidden");
    setNote("");
  }
  setStep("flush", "done");
  currentStep = null;
}

async function handleAbort() {
  setStep("flush", "error");
  try {
    await setDbStatus("berlangsung");
    render();
    showResult("info", "Penutupan dibatalkan. Sesi kembali berlangsung dan mahasiswa dapat memilih lagi.");
    showToast("info", "Penutupan dibatalkan.");
  } catch (err) {
    render();
    showResult("error", `Gagal membatalkan penutupan: ${err.message} Coba klik "Batalkan penutupan" di halaman ini.`);
  }
}

// Transaksi yang sudah terkirim tapi melewati TX_CONFIRM_TIMEOUT_MS tanpa konfirmasi.
// Disimpan di sini supaya tombol "Coba Muat Ulang Status" tahu apa yang mau diperiksa.
let pendingWatch = null; // { action, cfg, txHash } | null

// Balapan antara tx.wait() dan batas waktu. Kalau batas waktu menang, tx.wait() TIDAK
// dibatalkan; ia tetap berjalan di latar belakang (hasilnya diabaikan di sini, supaya
// tidak pernah menjadi unhandled rejection), dan transaksinya tetap bisa terkonfirmasi
// nanti. Pemeriksaannya sendiri dilakukan lewat getTransactionReceipt di checkPendingStatus.
async function waitForConfirmation(tx, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const wait = tx
    .wait()
    .then((receipt) => ({ timedOut: false, receipt }))
    .catch((error) => ({ timedOut: false, error }));

  const result = await Promise.race([wait, timeout]);
  clearTimeout(timer);
  if (result.error) throw result.error;
  return result;
}

// Tahap setelah transaksi terkonfirmasi (sama untuk alur normal maupun setelah
// "Coba Muat Ulang Status" menemukan konfirmasinya): baca status terbaru dari
// blockchain, simpan salinannya ke database (buka/tutup sesi), lalu tampilkan hasil.
async function finalizeSuccess(action, cfg, txHash) {
  const state = await readBack(cfg);
  chainState = state;
  chainError = null;

  if (cfg.steps.includes("db")) {
    setStep("db", "active");
    dbState = await syncDatabase(state, txHash, action);
    syncError = null;
    setStep("db", "done");
  }

  busy = false;
  pendingWatch = null;
  el.btnRetry.classList.add("hidden");
  render();
  showResult("success", cfg.success, txHash);
  showToast("success", cfg.success);

  if (action === "relayer") el.relayerInput.value = "";
  loadLive()
    .then(render)
    .catch(() => { });
}

// Popup berhenti menunggu tanpa batas: tampilkan status "menunggu konfirmasi" yang BISA
// ditutup, dengan tombol untuk memeriksa ulang kapan saja.
function enterPendingState(action, cfg, txHash) {
  busy = false;
  pendingWatch = { action, cfg, txHash };

  const menit = Math.round(TX_CONFIRM_TIMEOUT_MS / 60000);
  showResult(
    "info",
    `Belum ada konfirmasi dari jaringan setelah ${menit} menit. Transaksi mungkin masih diproses` +
    ` (terutama jika koneksi Anda sempat terputus). Jendela ini sekarang bisa ditutup. Klik` +
    ` "Coba Muat Ulang Status" kapan saja untuk memeriksa, atau tutup dan periksa lagi nanti lewat` +
    ` tombol "Muat ulang" di halaman ini.`,
    txHash
  );
  el.btnRetry.classList.remove("hidden");
  el.btnRetry.disabled = false;
  el.btnRetry.textContent = "Coba Muat Ulang Status";
  render();
}

// Tombol "Coba Muat Ulang Status": cek sekali ke blockchain lewat getTransactionReceipt
// (bukan tx.wait() lagi, supaya tidak menunggu tanpa batas untuk kedua kalinya).
async function checkPendingStatus() {
  if (!pendingWatch || !wallet) return;
  const { action, cfg, txHash } = pendingWatch;

  el.btnRetry.disabled = true;
  el.btnRetry.textContent = "Memeriksa...";
  setNote("Memeriksa status transaksi di blockchain...");

  try {
    const receipt = await wallet.provider.getTransactionReceipt(txHash);

    if (!receipt) {
      setNote('Transaksi masih belum terkonfirmasi. Tunggu sebentar lalu coba lagi.');
      el.btnRetry.disabled = false;
      el.btnRetry.textContent = "Coba Muat Ulang Status";
      return;
    }

    setNote("");
    el.btnRetry.classList.add("hidden");

    if (receipt.status !== 1) {
      pendingWatch = null;
      busy = false;
      render();
      showResult("error", "Transaksi ditolak jaringan (gagal/revert). Coba ulangi aksinya dari awal.", txHash);
      return;
    }

    busy = true; // kunci modal lagi selama tahap sisanya (db, dst) diproses
    render();
    setStep("chain", "done");
    currentStep = null;

    try {
      await finalizeSuccess(action, cfg, txHash);
    } catch (e) {
      busy = false;
      const d = describeChainError(e);
      let message = d.message;
      if (currentStep === "db") {
        message = `Transaksi berhasil di blockchain, tetapi database gagal diperbarui: ${e.message} Muat ulang halaman ini; sinkronisasi dilakukan otomatis.`;
      }
      pendingWatch = { action, cfg, txHash }; // tetap bisa dicoba lagi
      render();
      showResult(d.type === "info" ? "info" : "error", message, txHash);
      el.btnRetry.classList.remove("hidden");
      el.btnRetry.disabled = false;
      el.btnRetry.textContent = "Coba Muat Ulang Status";
    }
  } catch (e) {
    setNote(`Gagal memeriksa status: ${e.message}`);
    el.btnRetry.disabled = false;
    el.btnRetry.textContent = "Coba Muat Ulang Status";
  }
}

async function runAction() {
  if (busy || !pendingAction) return;
  if (pendingAction !== "kontrak" && !wallet) return; // mengatur kontrak hanya mengubah database; tanpa MetaMask
  const action = pendingAction;
  const cfg = ACTIONS[action];

  busy = true;
  render();
  showProgress(cfg);

  let txHash = null;
  try {
    if (action === "kontrak") {
      await terapkanKontrak();
      return;
    }
    if (action === "open") await prepareOpen();
    if (action === "close") await prepareClose();

    // 1) Simulasi dulu (tanpa biaya): jika kontrak akan menolak, pesannya jelas dan admin
    //    tidak membuang gas untuk transaksi yang pasti gagal.
    setStep("wallet", "active");
    const signer = await wallet.provider.getSigner(wallet.address);
    const contract = getSessionContract(signer);
    const call = buildCall(contract, action);
    await call.method.staticCall(...call.args);

    // 2) Kirim transaksi -> MetaMask meminta konfirmasi admin di sini
    const tx = await call.method(...call.args);
    txHash = tx.hash;
    setStep("wallet", "done");

    // 3) Tunggu terkonfirmasi di jaringan, maksimal TX_CONFIRM_TIMEOUT_MS. Kalau lewat batas
    //    ini (mis. koneksi admin macet), berhenti MENUNGGU, bukan membatalkan transaksinya.
    setStep("chain", "active");
    const outcome = await waitForConfirmation(tx, TX_CONFIRM_TIMEOUT_MS);

    if (outcome.timedOut) {
      enterPendingState(action, cfg, txHash);
      return;
    }

    if (!outcome.receipt || outcome.receipt.status !== 1) throw new Error("Transaksi gagal di blockchain.");
    setStep("chain", "done");
    currentStep = null; // transaksi sudah sah di blockchain; kegagalan berikutnya bukan kegagalan tahap ini

    // 4) Baca status terbaru + 5) simpan salinan ke database (hanya untuk buka/tutup sesi)
    await finalizeSuccess(action, cfg, txHash);
  } catch (e) {
    busy = false;

    if (e && e.aborted) {
      await handleAbort();
      return;
    }

    if (currentStep) setStep(currentStep, "error");

    const d = describeChainError(e);
    let message = d.message;
    // Gagal di tahap database padahal transaksi sudah berhasil di blockchain
    if (currentStep === "db" && action !== "kontrak") {
      message = `Transaksi berhasil di blockchain, tetapi database gagal diperbarui: ${e.message} Muat ulang halaman ini; sinkronisasi dilakukan otomatis.`;
      syncError = e.message;
    }
    // Penutupan terhenti di tengah jalan: beri tahu keadaan dan pilihan berikutnya
    if (action === "close" && closingInProgress()) {
      message += ' Penerimaan suara sudah dihentikan. Klik "Lanjutkan Penutupan" untuk mencoba lagi, atau "Batalkan penutupan" untuk membuka kembali sesi.';
    }

    render();
    showResult(d.type === "info" ? "info" : "error", message, txHash);
    showToast(d.type === "info" ? "info" : "error", d.type === "info" ? "Transaksi dibatalkan." : "Proses tidak selesai.");
  }
}

// ---------------------------------------------------------
// Event
// ---------------------------------------------------------
el.btnConnect.addEventListener("click", connectWallet);
el.btnSwitch.addEventListener("click", switchNetwork);

el.refreshBtn.addEventListener("click", async () => {
  if (busy) return;
  if (blockchainConfigProblem()) return;
  await loadAll();
  showToast("info", "Data diperbarui dari blockchain dan database.");
});

el.btnOpen.addEventListener("click", () => openConfirm("open"));
el.btnClose.addEventListener("click", () => openConfirm("close"));
el.btnSetRelayer.addEventListener("click", () => openConfirm("relayer"));
el.relayerInput.addEventListener("input", renderRelayerForm);
el.relayerToggle.addEventListener("change", toggleRelayerAktif);
el.kontrakInput.addEventListener("input", renderKontrakPanel);
el.kontrakReset.addEventListener("change", renderKontrakPanel);
el.btnSetKontrak.addEventListener("click", () => openConfirm("kontrak"));
el.btnRelayerCek.addEventListener("click", () => runRelayerControl("cek", "Memeriksa...", el.btnRelayerCek));
el.btnRelayerKirim.addEventListener("click", () => runRelayerControl("paksa", "Mengirim...", el.btnRelayerKirim));

el.btnCancelClose.addEventListener("click", async () => {
  if (busy || !closingInProgress()) return;
  el.btnCancelClose.disabled = true;
  try {
    await setDbStatus("berlangsung");
    showToast("info", "Penutupan dibatalkan. Sesi kembali berlangsung.");
  } catch (e) {
    showToast("error", `Gagal membatalkan penutupan: ${e.message}`);
  }
  render();
});

el.btnCancel.addEventListener("click", closeModal);
el.btnConfirm.addEventListener("click", runAction);
el.btnClose2.addEventListener("click", closeModal);
el.btnAbort.addEventListener("click", () => {
  abortRequested = true;
  el.btnAbort.disabled = true;
  setNote("Membatalkan penutupan...");
});
el.btnRetry.addEventListener("click", checkPendingStatus);

// Klik di luar kotak = batal (hanya saat belum memproses)
el.overlay.addEventListener("click", (e) => {
  if (e.target === el.overlay && !busy && !el.viewConfirm.classList.contains("hidden")) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (el.overlay.classList.contains("hidden")) return;

  if (e.key === "Escape" && !busy) {
    closeModal();
    return;
  }

  // Jaga fokus keyboard tetap di dalam popup
  if (e.key === "Tab") {
    const focusables = Array.from(el.modal.querySelectorAll("button:not([disabled])")).filter(
      (b) => b.offsetParent !== null
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// Halaman hanya dimuat setelah penjagaan akses admin (Sidebar.js) selesai
(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) init();
});