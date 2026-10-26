// Membuat wallet baru khusus untuk relayer.
// Jalankan: npm run buat-wallet
const { ethers } = require("ethers");

const wallet = ethers.Wallet.createRandom();

console.log("\nWallet relayer baru berhasil dibuat.\n");
console.log("Alamat (aman dibagikan, dipakai saat deploy kontrak):");
console.log("  " + wallet.address + "\n");
console.log("Private key (RAHASIA, taruh di file .env sebagai RELAYER_PRIVATE_KEY):");
console.log("  " + wallet.privateKey + "\n");
console.log("Penting:");
console.log("  - Simpan private key di tempat aman. Siapa pun yang memilikinya bisa menjalankan relayer ini.");
console.log("  - Isi alamat di atas dengan sedikit koin uji Sepolia (faucet) agar bisa membayar gas.");
console.log("  - Jangan pakai wallet ini untuk hal lain, dan jangan gunakan wallet admin sebagai relayer.\n");
