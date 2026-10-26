/* =========================================================
   Blockchain.js
   Fungsi-fungsi bersama untuk berbicara dengan kontrak
   VotingSession lewat library ethers.js. Dipakai oleh
   landing.html (membaca) dan admin/sesi-voting.html (membaca
   & menulis).

   Butuh dimuat SEBELUM file ini:
     - library ethers.js (CDN)
     - Blockchainconfig.js
   ========================================================= */

// Nomor status di kontrak -> nama status yang dipakai di database (tb_sesi_voting)
const CHAIN_STATUS_KEYS = { 0: "belum_mulai", 1: "berlangsung", 2: "selesai" };

// Mengembalikan kode masalah konfigurasi, atau null jika semuanya siap dipakai:
//   "no_file" | "no_ethers" | "no_address" | "bad_address"
function blockchainConfigCode() {
  if (typeof BLOCKCHAIN === "undefined" || typeof VOTING_SESSION_ABI === "undefined") return "no_file";
  if (typeof ethers === "undefined") return "no_ethers";
  if (!BLOCKCHAIN.CONTRACT_ADDRESS) return "no_address";
  if (!ethers.isAddress(BLOCKCHAIN.CONTRACT_ADDRESS)) return "bad_address";
  return null;
}

// Versi teks dari masalah konfigurasi (null jika tidak ada masalah).
function blockchainConfigProblem() {
  const messages = {
    no_file: "File js/Blockchainconfig.js tidak ditemukan atau gagal dimuat.",
    no_ethers: "Library ethers.js gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.",
    no_address:
      "Alamat kontrak belum diisi. Isi CONTRACT_ADDRESS di js/Blockchainconfig.js setelah mendeploy kontrak.",
    bad_address: "Alamat kontrak di js/Blockchainconfig.js tidak valid.",
  };
  const code = blockchainConfigCode();
  return code ? messages[code] : null;
}

// Provider khusus MEMBACA lewat RPC publik (tidak butuh MetaMask, bisa dipakai siapa saja).
let readProviderInstance = null;
function getReadProvider() {
  if (!readProviderInstance) {
    readProviderInstance = new ethers.JsonRpcProvider(
      BLOCKCHAIN.RPC_URL,
      ethers.Network.from(BLOCKCHAIN.CHAIN_ID),
      // staticNetwork: tidak perlu menanyakan chain id berulang kali.
      // batchMaxCount 1: beberapa RPC publik menolak permintaan yang digabung (batch).
      { staticNetwork: ethers.Network.from(BLOCKCHAIN.CHAIN_ID), batchMaxCount: 1 }
    );
  }
  return readProviderInstance;
}

// runner = provider (untuk membaca) atau signer (untuk menulis)
function getSessionContract(runner) {
  return new ethers.Contract(BLOCKCHAIN.CONTRACT_ADDRESS, VOTING_SESSION_ABI, runner || getReadProvider());
}

// Membaca seluruh keadaan sesi dari kontrak.
// Waktu dikembalikan dalam detik unix (0 = belum terjadi); alamat null jika belum terjadi.
async function readSessionState(contract) {
  const [status, owner, relayer, totalVotes, openedBy, openedAt, closedBy, closedAt] = await Promise.all([
    contract.status(),
    contract.owner(),
    contract.relayer(),
    contract.totalVotes(),
    contract.openedBy(),
    contract.openedAt(),
    contract.closedBy(),
    contract.closedAt(),
  ]);

  const statusNum = Number(status);
  return {
    status: statusNum,
    statusKey: CHAIN_STATUS_KEYS[statusNum] || "tidak_diketahui",
    owner,
    relayer,
    totalVotes: Number(totalVotes),
    openedAt: Number(openedAt),
    openedBy: openedAt > 0n ? openedBy : null,
    closedAt: Number(closedAt),
    closedBy: closedAt > 0n ? closedBy : null,
  };
}

// Membaca hitungan suara semua paslon dari kontrak.
// Mengembalikan { numbers: [1, 2, ...], counts: [12, 9, ...] } (urut sama).
async function readResults(contract) {
  const [numbers, counts] = await contract.getResults();
  return { numbers: numbers.map(Number), counts: counts.map(Number) };
}

// Mengubah error dari ethers/MetaMask menjadi pesan yang mudah dimengerti.
// Mengembalikan { type: "info" | "error", message }.
function describeChainError(e) {
  const code = e && e.code;
  const nested = e && e.info && e.info.error && e.info.error.code;

  // Admin menekan "Tolak/Reject" di MetaMask
  if (code === "ACTION_REJECTED" || code === 4001 || nested === 4001) {
    return { type: "info", message: "Transaksi dibatalkan di MetaMask. Tidak ada perubahan." };
  }
  if (code === "INSUFFICIENT_FUNDS") {
    return {
      type: "error",
      message: "Saldo wallet tidak cukup untuk membayar biaya gas. Isi saldo uji lewat faucet jaringan Sepolia.",
    };
  }
  if (code === "CALL_EXCEPTION" && e.revert) {
    if (e.revert.name === "NotOwner") {
      return {
        type: "error",
        message: "Wallet ini bukan pemilik kontrak. Gunakan wallet yang dipakai saat mendeploy kontrak.",
      };
    }
    if (e.revert.name === "InvalidState") {
      return { type: "error", message: "Aksi ini tidak dapat dilakukan pada status sesi saat ini." };
    }
    if (e.revert.name === "InvalidCandidates") {
      return {
        type: "error",
        message: "Daftar nomor paslon tidak valid (kosong, lebih dari 50, berisi 0, atau ada nomor ganda). Periksa data kandidat.",
      };
    }
    if (e.revert.name === "ZeroAddress") {
      return { type: "error", message: "Alamat tidak boleh kosong atau alamat nol." };
    }
    if (e.revert.name === "NotRelayer") {
      return { type: "error", message: "Wallet ini bukan relayer yang terdaftar di kontrak." };
    }
  }
  // Tidak ada kontrak di alamat tersebut (alamat salah, atau jaringan tidak cocok)
  if (code === "BAD_DATA" || (code === "CALL_EXCEPTION" && !e.revert)) {
    return {
      type: "error",
      message: `Kontrak tidak ditemukan di alamat tersebut pada jaringan ${BLOCKCHAIN.CHAIN_NAME}. Periksa CONTRACT_ADDRESS dan CHAIN_ID di js/Blockchainconfig.js.`,
    };
  }
  if (code === "NETWORK_ERROR" || code === "SERVER_ERROR" || code === "TIMEOUT") {
    return { type: "error", message: "Tidak dapat terhubung ke jaringan blockchain. Coba lagi beberapa saat lagi." };
  }
  return { type: "error", message: (e && (e.shortMessage || e.message)) || "Terjadi kesalahan yang tidak diketahui." };
}

// ---------------------------------------------------------
// Format tampilan
// ---------------------------------------------------------

// 0x7A3f8b92c1d4e5f6a7b8c9d0e1f2a3b4c5d69e21 -> 0x7A3f...9e21
function shortAddress(address) {
  return address && address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address || "";
}

// Detik unix -> teks tanggal & jam WITA, contoh: "9 Jun 2026, 20.00 WITA"
function formatChainTime(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const tanggal = d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  });
  const jam = d
    .toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Makassar",
    })
    .replace(":", ".");
  return `${tanggal}, ${jam} WITA`;
}

function unixToIso(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString();
}