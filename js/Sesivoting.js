/* =========================================================
   Sesivoting.js
   Logic untuk admin/sesi-voting.html — membuka & menutup sesi
   voting lewat smart contract VotingSession di blockchain.

   Alur singkat:
   1. Status sesi DIBACA dari blockchain (RPC publik, tanpa wallet).
   2. Admin menghubungkan MetaMask (harus wallet pemilik kontrak).
   3. Klik "Mulai"/"Tutup" -> popup konfirmasi -> simulasi transaksi ->
      konfirmasi di MetaMask -> tunggu terkonfirmasi di jaringan.
   4. Setelah terkonfirmasi, salinan status disimpan ke tabel
      tb_sesi_voting agar server bisa menolak suara di luar sesi.
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
// Elemen & state
// ---------------------------------------------------------
const el = {
  configAlert: document.getElementById("config-alert"),
  badge: document.getElementById("session-badge"),
  openedInfo: document.getElementById("opened-info"),
  closedInfo: document.getElementById("closed-info"),
  ownerInfo: document.getElementById("owner-info"),
  contractInfo: document.getElementById("contract-info"),
  networkInfo: document.getElementById("network-info"),
  dbInfo: document.getElementById("db-info"),
  btnOpen: document.getElementById("btn-open"),
  btnClose: document.getElementById("btn-close"),
  hint: document.getElementById("action-hint"),
  refreshBtn: document.getElementById("refresh-btn"),
  walletAddress: document.getElementById("wallet-address"),
  walletChips: document.getElementById("wallet-chips"),
  walletHelp: document.getElementById("wallet-help"),
  btnConnect: document.getElementById("btn-connect"),
  btnSwitch: document.getElementById("btn-switch"),
  overlay: document.getElementById("tx-overlay"),
  modal: document.getElementById("tx-modal"),
  viewConfirm: document.getElementById("tx-view-confirm"),
  viewProgress: document.getElementById("tx-view-progress"),
  title: document.getElementById("tx-title"),
  text: document.getElementById("tx-text"),
  points: document.getElementById("tx-points"),
  warning: document.getElementById("tx-warning"),
  btnCancel: document.getElementById("tx-cancel"),
  btnConfirm: document.getElementById("tx-confirm"),
  progressTitle: document.getElementById("tx-progress-title"),
  steps: document.getElementById("tx-steps"),
  result: document.getElementById("tx-result"),
  btnClose2: document.getElementById("tx-close"),
};

let chainState = null; // keadaan sesi dari blockchain
let chainError = null;
let dbState = null; // baris tb_sesi_voting
let dbError = null;
let syncError = null;
let wallet = null; // { provider, address, chainId }
let busy = false; // true selama transaksi diproses
let pendingAction = null; // "open" | "close"
let currentStep = null;
let lastFocusedEl = null;
let walletListenersAttached = false;

const STATUS_LABEL = { 0: "Belum dimulai", 1: "Sedang berlangsung", 2: "Telah ditutup" };
const DB_LABEL = { belum_mulai: "Belum dimulai", berlangsung: "Sedang berlangsung", selesai: "Telah ditutup" };

const TX_TEXT = {
  open: {
    title: "Mulai Sesi Voting?",
    text: "Anda akan membuka sesi pemilihan Ketua HMTI di blockchain.",
    points: [
      "Mahasiswa yang sudah disetujui dapat langsung memberikan suara.",
      "Pembukaan sesi dicatat permanen bersama alamat wallet Anda dan waktunya.",
      "Anda perlu mengonfirmasi transaksi di MetaMask dan membayar biaya gas.",
    ],
    warning: "Pastikan data kandidat sudah lengkap dan benar sebelum memulai.",
    danger: false,
    confirmLabel: "Ya, Mulai Sesi",
    confirmClass: "btn-primary",
    progressTitle: "Membuka sesi voting",
    expectedStatus: 1,
    success: "Sesi voting berhasil dibuka.",
  },
  close: {
    title: "Tutup Sesi Voting?",
    text: "Anda akan menutup sesi pemilihan Ketua HMTI secara permanen.",
    points: [
      "Mahasiswa tidak dapat lagi memberikan suara.",
      "Sesi yang sudah ditutup TIDAK dapat dibuka kembali.",
      "Penutupan dicatat permanen di blockchain dan tidak bisa dihapus.",
    ],
    warning: "Tindakan ini tidak dapat dibatalkan. Pastikan pemilihan memang sudah selesai.",
    danger: true,
    confirmLabel: "Ya, Tutup Sesi",
    confirmClass: "btn-danger-solid",
    progressTitle: "Menutup sesi voting",
    expectedStatus: 2,
    success: "Sesi voting berhasil ditutup.",
  },
};

// ---------------------------------------------------------
// Inisialisasi & pemuatan data
// ---------------------------------------------------------
async function init() {
  el.networkInfo.textContent = `${BLOCKCHAIN.CHAIN_NAME} (ID ${BLOCKCHAIN.CHAIN_ID})`;
  el.contractInfo.textContent = BLOCKCHAIN.CONTRACT_ADDRESS || "Belum diisi";

  const problem = blockchainConfigProblem();
  if (problem) {
    el.configAlert.textContent = problem;
    el.configAlert.className = "status-msg error";
    chainError = problem;
    render();
    return;
  }

  await restoreWallet();
  await loadAll();
}

async function loadAll() {
  setBadge("loading", "Memuat...");
  await Promise.all([loadChain(getReadProvider()), loadDb()]);
  await autoSync();
  render();
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

function needsSync(chain, db) {
  return (
    db.status !== chain.statusKey ||
    (chain.openedAt && !db.dibuka_pada) ||
    (chain.closedAt && !db.ditutup_pada)
  );
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

function render() {
  // Badge status
  if (chainError) setBadge("error", "Tidak dapat dibaca");
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
  el.btnOpen.disabled = !(gate.canAct && chainState.status === 0);
  el.btnClose.disabled = !(gate.canAct && chainState.status === 1);
  el.hint.textContent = gate.hint;
}

function actionGate() {
  if (blockchainConfigProblem()) {
    return { canAct: false, hint: "Selesaikan pengaturan kontrak terlebih dahulu (lihat pesan di atas)." };
  }
  if (chainError) {
    return { canAct: false, hint: 'Status sesi belum dapat dibaca dari blockchain. Klik "Muat ulang".' };
  }
  if (!chainState) return { canAct: false, hint: "Memuat status sesi..." };
  if (chainState.status === 2) {
    return {
      canAct: false,
      hint: "Sesi sudah ditutup secara permanen dan tidak dapat dibuka kembali. Untuk pemilihan baru, deploy kontrak baru.",
    };
  }
  if (busy) return { canAct: false, hint: "Transaksi sedang diproses..." };
  if (!wallet) return { canAct: false, hint: "Hubungkan MetaMask untuk membuka atau menutup sesi." };
  if (wallet.chainId !== BLOCKCHAIN.CHAIN_ID) {
    return { canAct: false, hint: `MetaMask berada di jaringan lain. Ganti ke ${BLOCKCHAIN.CHAIN_NAME}.` };
  }
  if (!sameAddress(wallet.address, chainState.owner)) {
    return {
      canAct: false,
      hint: `Wallet yang terhubung bukan pemilik kontrak. Pilih akun ${shortAddress(chainState.owner)} di MetaMask.`,
    };
  }
  return {
    canAct: true,
    hint:
      chainState.status === 0
        ? 'Sesi belum dimulai. Klik "Mulai Sesi Voting" untuk membuka pemilihan.'
        : 'Sesi sedang berlangsung. Klik "Tutup Sesi Voting" jika pemilihan sudah selesai.',
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

el.btnConnect.addEventListener("click", connectWallet);
el.btnSwitch.addEventListener("click", switchNetwork);
el.refreshBtn.addEventListener("click", async () => {
  if (busy) return;
  if (blockchainConfigProblem()) return;
  await loadAll();
  showToast("info", "Status sesi diperbarui dari blockchain.");
});

// ---------------------------------------------------------
// Popup konfirmasi & transaksi
// ---------------------------------------------------------
function openConfirm(action) {
  const button = action === "open" ? el.btnOpen : el.btnClose;
  if (busy || button.disabled) return;

  const cfg = TX_TEXT[action];
  pendingAction = action;
  lastFocusedEl = document.activeElement;

  el.title.textContent = cfg.title;
  el.text.textContent = cfg.text;
  el.points.innerHTML = "";
  cfg.points.forEach((p) => {
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

function setStep(name, state) {
  currentStep = state === "active" ? name : currentStep;
  const li = el.steps.querySelector(`[data-step="${name}"]`);
  if (li) li.dataset.state = state;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTransaction() {
  if (busy || !pendingAction || !wallet) return;
  const action = pendingAction;
  const cfg = TX_TEXT[action];

  busy = true;
  render();

  // Pindah ke tampilan progres
  el.viewConfirm.classList.add("hidden");
  el.viewProgress.classList.remove("hidden");
  el.progressTitle.textContent = cfg.progressTitle;
  el.result.className = "status-msg hidden";
  el.btnClose2.classList.add("hidden");
  el.steps.querySelectorAll("li").forEach((li) => (li.dataset.state = "pending"));
  currentStep = null;

  let txHash = null;
  try {
    // 1) Simulasi dulu (tanpa biaya): jika kontrak akan menolak, pesannya jelas
    //    dan admin tidak membuang gas untuk transaksi yang pasti gagal.
    setStep("wallet", "active");
    const signer = await wallet.provider.getSigner(wallet.address);
    const contract = getSessionContract(signer);
    const method = action === "open" ? contract.openSession : contract.closeSession;
    await method.staticCall();

    // 2) Kirim transaksi -> MetaMask meminta konfirmasi admin di sini
    const tx = await method();
    txHash = tx.hash;
    setStep("wallet", "done");

    // 3) Tunggu terkonfirmasi di jaringan
    setStep("chain", "active");
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Transaksi gagal di blockchain.");
    setStep("chain", "done");
    currentStep = null; // transaksi sudah sah di blockchain; kegagalan berikutnya bukan kegagalan tahap ini

    // 4) Baca status terbaru (lewat provider wallet agar tidak tertinggal RPC publik)
    let state = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      state = await readSessionState(getSessionContract(wallet.provider));
      if (state.status === cfg.expectedStatus) break;
      await sleep(1000);
    }
    if (!state || state.status !== cfg.expectedStatus) {
      throw new Error("Transaksi terkonfirmasi, tetapi status terbaru belum terbaca. Klik \"Muat ulang\" beberapa saat lagi.");
    }
    chainState = state;
    chainError = null;

    // 5) Simpan salinan ke database
    setStep("db", "active");
    dbState = await syncDatabase(state, txHash, action);
    syncError = null;
    setStep("db", "done");

    busy = false;
    render();
    showResult("success", cfg.success, txHash);
    showToast("success", cfg.success);
  } catch (e) {
    busy = false;
    if (currentStep) setStep(currentStep, "error");

    const d = describeChainError(e);
    let message = d.message;
    // Gagal di tahap database padahal transaksi sudah berhasil di blockchain
    if (currentStep === "db") {
      message = `Transaksi berhasil di blockchain, tetapi database gagal diperbarui: ${e.message} Muat ulang halaman ini; sinkronisasi dilakukan otomatis.`;
      syncError = e.message;
    }
    render();
    showResult(d.type === "info" ? "info" : "error", message, txHash);
    showToast(d.type === "info" ? "info" : "error", d.type === "info" ? "Transaksi dibatalkan." : "Transaksi tidak selesai.");
  }
}

el.btnOpen.addEventListener("click", () => openConfirm("open"));
el.btnClose.addEventListener("click", () => openConfirm("close"));
el.btnCancel.addEventListener("click", closeModal);
el.btnConfirm.addEventListener("click", runTransaction);
el.btnClose2.addEventListener("click", closeModal);

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
