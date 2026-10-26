/* =========================================================
   Blockchainconfig.js
   Pengaturan koneksi ke blockchain. File ini yang Anda ubah
   setelah mendeploy kontrak (lihat blockchain/PANDUAN_DEPLOY.md).

   WAJIB DIISI: CONTRACT_ADDRESS.
   ========================================================= */

const BLOCKCHAIN = {
  // Alamat kontrak VotingSession hasil deploy, contoh: "0x1234...abcd"
  CONTRACT_ADDRESS: "0x70344AC571ed3668F1dB392A6e62c3d82F189E80",

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