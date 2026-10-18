/* =========================================================
   Blockchainconfig.js
   Pengaturan koneksi ke blockchain. File ini yang Anda ubah
   setelah mendeploy kontrak (lihat blockchain/PANDUAN_DEPLOY.md).

   WAJIB DIISI: CONTRACT_ADDRESS.
   ========================================================= */

const BLOCKCHAIN = {
  // Alamat kontrak VotingSession hasil deploy, contoh: "0x1234...abcd"
  CONTRACT_ADDRESS: "",

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
// Harus identik dengan hasil kompilasi blockchain/VotingSession.sol
// (diperiksa otomatis oleh `npm test` di folder blockchain/).
const VOTING_SESSION_ABI = [
  "function owner() view returns (address)",
  "function status() view returns (uint8)",
  "function openedBy() view returns (address)",
  "function openedAt() view returns (uint256)",
  "function closedBy() view returns (address)",
  "function closedAt() view returns (uint256)",
  "function openSession()",
  "function closeSession()",
  "event SessionOpened(address indexed admin, uint256 timestamp)",
  "event SessionClosed(address indexed admin, uint256 timestamp)",
  "error NotOwner()",
  "error InvalidState(uint8 current)",
];
