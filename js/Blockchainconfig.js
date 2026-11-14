/* =========================================================
   Blockchainconfig.js
   Pengaturan koneksi ke blockchain. File ini yang Anda ubah
   setelah mendeploy kontrak (lihat blockchain/PANDUAN_DEPLOY.md).

   ALAMAT KONTRAK tidak lagi harus diedit di sini setiap pemilihan baru: admin
   mengaturnya di menu Sesi Voting > Kontrak Pemilihan (disimpan di database).
   CONTRACT_ADDRESS di bawah hanya CADANGAN, dipakai bila database belum mengaturnya.
   ========================================================= */

const BLOCKCHAIN = {
  // Alamat CADANGAN kontrak VotingSession, contoh: "0x1234...abcd". Alamat yang diatur
  // admin di database selalu didahulukan (lihat muatAlamatKontrak di bawah).
  CONTRACT_ADDRESS: "0x991352F75B811Bb7A81d82C9259FE046DF3c9dE7",

  // Jaringan yang dipakai. Bawaan: Sepolia (jaringan uji, tanpa uang sungguhan).
  CHAIN_ID: 11155111,
  CHAIN_NAME: "Sepolia (jaringan uji)",

  // Alamat RPC publik untuk MEMBACA data (dipakai semua pengunjung, tanpa MetaMask).
  // Jika sering lambat/gagal, ganti dengan RPC Sepolia gratis dari Alchemy/Infura.
  RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",

  // Dipakai untuk tautan "Lihat transaksi" di halaman admin (boleh dikosongkan).
  EXPLORER_URL: "https://sepolia.etherscan.io",

  // Dipakai jika jaringan belum ada di MetaMask admin (Sepolia sudah bawaan MetaMask).
  NATIVE_CURRENCY: { name: "Sepolia Ether", symbol: "SepoliaETH", decimals: 18 },
};

// ABI = "daftar isi" kontrak yang dibutuhkan ethers.js untuk berbicara dengannya.
// Dihasilkan otomatis dari hasil kompilasi blockchain/VotingSession.sol. Jika kontrak
// diubah, ABI ini harus diperbarui (diperiksa otomatis oleh `npm test` di folder blockchain/).
const VOTING_SESSION_ABI = [
  "error InvalidBatch()",
  "error InvalidCandidate(uint8 number)",
  "error InvalidCandidates()",
  "error InvalidState(uint8 current)",
  "error NotOwner()",
  "error NotRelayer()",
  "error ZeroAddress()",
  "event CandidatesRegistered(uint8[] numbers)",
  "event RelayerChanged(address indexed previousRelayer, address indexed newRelayer)",
  "event SessionClosed(address indexed admin, uint256 timestamp)",
  "event SessionOpened(address indexed admin, uint256 timestamp)",
  "event VotesCast(uint256 accepted, uint256 duplicates, uint256 totalVotes)",
  "function MAX_BATCH() view returns (uint256)",
  "function MAX_CANDIDATES() view returns (uint256)",
  "function candidateCount() view returns (uint256)",
  "function castVotes(bytes32[] ids, uint8[] numbers)",
  "function closeSession()",
  "function closedAt() view returns (uint256)",
  "function closedBy() view returns (address)",
  "function getResults() view returns (uint8[] numbers, uint256[] counts)",
  "function isCandidate(uint8) view returns (bool)",
  "function openSession(uint8[] numbers)",
  "function openedAt() view returns (uint256)",
  "function openedBy() view returns (address)",
  "function owner() view returns (address)",
  "function relayer() view returns (address)",
  "function setRelayer(address newRelayer)",
  "function status() view returns (uint8)",
  "function totalVotes() view returns (uint256)",
  "function voteCounted(bytes32) view returns (bool)",
  "function votesFor(uint8) view returns (uint256)",
];

// ---------------------------------------------------------
// Alamat kontrak aktif (dibaca dari database)
// ---------------------------------------------------------
// Alamat yang tertulis di file ini, disimpan sebagai cadangan.
const ALAMAT_KONTRAK_FILE = BLOCKCHAIN.CONTRACT_ADDRESS;

// Memuat alamat kontrak AKTIF dari tb_pengaturan_kontrak lalu menaruhnya di
// BLOCKCHAIN.CONTRACT_ADDRESS. Panggil (dan tunggu) sebelum memakai kontrak.
// Isi BLOCKCHAIN.ADDRESS_SOURCE sesudahnya:
//   "database" : diatur admin di database (yang berlaku)
//   "file"     : database belum mengaturnya (atau fiturnya belum dipasang); pakai cadangan di atas
//   "none"     : tidak ada alamat sama sekali
//   "error"    : database gagal dibaca. Alamat SENGAJA dikosongkan, bukan jatuh ke cadangan,
//                supaya halaman tidak diam-diam menampilkan kontrak lama.
async function muatAlamatKontrak() {
  BLOCKCHAIN.ADDRESS_ERROR = null;
  BLOCKCHAIN.ADDRESS_UPDATED_AT = null;
  try {
    const { data, error } = await sb
      .from("tb_pengaturan_kontrak")
      .select("contract_address, diperbarui_pada")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      // Tabel belum dibuat (patch_kontrak_dinamis.sql belum dijalankan): pakai cadangan
      if (error.code !== "42P01" && error.code !== "PGRST205") throw new Error(error.message);
    } else if (data && data.contract_address) {
      BLOCKCHAIN.CONTRACT_ADDRESS = data.contract_address;
      BLOCKCHAIN.ADDRESS_SOURCE = "database";
      BLOCKCHAIN.ADDRESS_UPDATED_AT = data.diperbarui_pada;
      return;
    }

    BLOCKCHAIN.CONTRACT_ADDRESS = ALAMAT_KONTRAK_FILE;
    BLOCKCHAIN.ADDRESS_SOURCE = ALAMAT_KONTRAK_FILE ? "file" : "none";
  } catch (e) {
    BLOCKCHAIN.CONTRACT_ADDRESS = "";
    BLOCKCHAIN.ADDRESS_SOURCE = "error";
    BLOCKCHAIN.ADDRESS_ERROR = (e && e.message) || String(e);
  }
}