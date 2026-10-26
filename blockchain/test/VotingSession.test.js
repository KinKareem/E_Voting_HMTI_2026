/* =========================================================
   Pengujian smart contract VotingSession.sol (versi 2: sesi + suara)

   Menjalankan kontrak di blockchain lokal (ganache, tanpa biaya & tanpa internet):
   mengompilasi VotingSession.sol, mendeploy, lalu memeriksa semua aturan.

   Cara menjalankan (di folder blockchain/):
     npm install
     npm test
   ========================================================= */

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  console.log((cond ? "  LULUS  " : "  GAGAL  ") + msg);
  cond ? passed++ : failed++;
}

// Memeriksa bahwa sebuah aksi DITOLAK kontrak:
//  1) simulasi (staticCall) -> mengambil nama custom error yang dilempar kontrak
//  2) pengiriman transaksi sungguhan -> harus benar-benar gagal (tidak pernah di-mine)
async function expectRevert(method, ...args) {
  let result = null;
  try {
    await method.staticCall(...args);
  } catch (e) {
    result = e.revert ? { name: e.revert.name, args: e.revert.args } : { name: "UNKNOWN:" + (e.shortMessage || e.message) };
  }
  if (!result) return null; // simulasi lolos = tidak ditolak

  let rejected = false;
  try {
    const tx = await method(...args);
    await tx.wait();
  } catch (e) {
    rejected = true;
  }
  return rejected ? result : { name: "TRANSAKSI-TETAP-BERHASIL" };
}

function compile() {
  const source = fs.readFileSync(path.join(__dirname, "..", "VotingSession.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "VotingSession.sol": { content: source } },
    settings: {
      evmVersion: "paris", // kompatibel dengan seluruh jaringan EVM (Sepolia, Polygon, dll.)
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) {
    errors.forEach((e) => console.error(e.formattedMessage));
    throw new Error("Kompilasi gagal");
  }
  (out.errors || []).forEach((w) => console.log("  [peringatan kompiler] " + w.message));
  const c = out.contracts["VotingSession.sol"].VotingSession;
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

const idAcak = () => ethers.hexlify(ethers.randomBytes(32));
const daftarId = (n) => Array.from({ length: n }, idAcak);
const parseEvents = (contract, receipt) =>
  receipt.logs
    .map((l) => {
      try {
        return contract.interface.parseLog(l);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

(async () => {
  console.log("\n== Kompilasi ==");
  const { abi, bytecode } = compile();
  ok(abi.length > 0 && bytecode.length > 10, `kontrak berhasil dikompilasi (${(bytecode.length - 2) / 2} byte bytecode)`);

  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337 }, miner: { blockTime: 0 } })
  );
  const admin = await provider.getSigner(0); // pemilik kontrak (wallet admin)
  const relayerA = await provider.getSigner(1); // relayer awal
  const orang = await provider.getSigner(2); // wallet lain
  const relayerB = await provider.getSigner(3); // relayer pengganti
  const [adminAddr, relayerAAddr, orangAddr, relayerBAddr] = await Promise.all(
    [admin, relayerA, orang, relayerB].map((s) => s.getAddress())
  );

  const factory = new ethers.ContractFactory(abi, bytecode, admin);

  // Deploy dengan alamat nol harus gagal
  let deployNolGagal = false;
  try {
    const c0 = await factory.deploy(ethers.ZeroAddress);
    await c0.waitForDeployment();
  } catch (e) {
    deployNolGagal = true;
  }
  ok(deployNolGagal, "deploy dengan relayer = alamat nol ditolak");

  const contract = await factory.deploy(relayerAAddr);
  await contract.waitForDeployment();
  const asRelayerA = contract.connect(relayerA);
  const asRelayerB = contract.connect(relayerB);
  const asOrang = contract.connect(orang);

  const NOT_STARTED = 0n, OPEN = 1n, CLOSED = 2n;

  console.log("\n== Kondisi awal ==");
  ok((await contract.owner()) === adminAddr, "owner = wallet yang mendeploy");
  ok((await contract.relayer()) === relayerAAddr, "relayer awal = alamat yang diberikan saat deploy");
  ok((await contract.status()) === NOT_STARTED, "status awal = NotStarted");
  ok((await contract.totalVotes()) === 0n && (await contract.candidateCount()) === 0n, "belum ada suara & belum ada paslon");

  console.log("\n== Mengganti relayer: kontrol akses ==");
  let r = await expectRevert(asOrang.setRelayer, orangAddr);
  ok(r && r.name === "NotOwner", "wallet lain TIDAK bisa mengganti relayer (NotOwner)");
  r = await expectRevert(asRelayerA.setRelayer, relayerAAddr);
  ok(r && r.name === "NotOwner", "relayer sendiri TIDAK bisa mengganti relayer (hanya owner)");
  r = await expectRevert(contract.setRelayer, ethers.ZeroAddress);
  ok(r && r.name === "ZeroAddress", "relayer tidak boleh diganti ke alamat nol (ZeroAddress)");

  console.log("\n== Sebelum sesi dibuka ==");
  r = await expectRevert(asRelayerA.castVotes, [idAcak()], [1]);
  ok(r && r.name === "InvalidState" && r.args[0] === NOT_STARTED, "suara sebelum sesi dibuka ditolak (InvalidState: NotStarted)");
  r = await expectRevert(contract.closeSession);
  ok(r && r.name === "InvalidState" && r.args[0] === NOT_STARTED, "menutup sesi yang belum dibuka ditolak");
  r = await expectRevert(asOrang.openSession, [1, 2]);
  ok(r && r.name === "NotOwner", "wallet lain TIDAK bisa membuka sesi (NotOwner)");
  r = await expectRevert(contract.openSession, []);
  ok(r && r.name === "InvalidCandidates", "membuka sesi tanpa paslon ditolak (InvalidCandidates)");
  r = await expectRevert(contract.openSession, [0, 1]);
  ok(r && r.name === "InvalidCandidates", "nomor paslon 0 ditolak");
  r = await expectRevert(contract.openSession, [1, 2, 1]);
  ok(r && r.name === "InvalidCandidates", "nomor paslon ganda ditolak");
  r = await expectRevert(contract.openSession, Array.from({ length: 51 }, (_, i) => i + 1));
  ok(r && r.name === "InvalidCandidates", "lebih dari 50 paslon ditolak");
  ok((await contract.status()) === NOT_STARTED, "status tetap NotStarted setelah semua percobaan gagal");

  console.log("\n== Membuka sesi (mendaftarkan paslon 1, 2, 3) ==");
  const txOpen = await contract.openSession([1, 2, 3]);
  const rcOpen = await txOpen.wait();
  const blockOpen = await provider.getBlock(rcOpen.blockNumber);
  ok((await contract.status()) === OPEN, "status menjadi Open");
  ok((await contract.openedBy()) === adminAddr && (await contract.openedAt()) === BigInt(blockOpen.timestamp), "openedBy & openedAt tercatat");
  const evOpen = parseEvents(contract, rcOpen);
  ok(evOpen.some((e) => e.name === "SessionOpened" && e.args.admin === adminAddr), "event SessionOpened dipancarkan");
  ok(evOpen.some((e) => e.name === "CandidatesRegistered" && Array.from(e.args.numbers).map(Number).join() === "1,2,3"), "event CandidatesRegistered(1,2,3) dipancarkan");
  ok((await contract.isCandidate(2)) === true && (await contract.isCandidate(4)) === false, "isCandidate: 2 sah, 4 tidak");
  ok((await contract.candidateCount()) === 3n, "candidateCount = 3");
  let [nums, counts] = await contract.getResults();
  ok(Array.from(nums).map(Number).join() === "1,2,3" && Array.from(counts).map(Number).join() === "0,0,0", "getResults awal: paslon 1,2,3 dengan 0 suara");
  r = await expectRevert(contract.openSession, [1, 2, 3]);
  ok(r && r.name === "InvalidState" && r.args[0] === OPEN, "sesi tidak bisa dibuka dua kali (daftar paslon terkunci)");

  console.log("\n== Mengirim suara: kontrol akses & validasi ==");
  r = await expectRevert(asOrang.castVotes, [idAcak()], [1]);
  ok(r && r.name === "NotRelayer", "wallet lain TIDAK bisa mengirim suara (NotRelayer)");
  r = await expectRevert(contract.castVotes, [idAcak()], [1]);
  ok(r && r.name === "NotRelayer", "owner (bukan relayer) TIDAK bisa mengirim suara");
  r = await expectRevert(asRelayerA.castVotes, [], []);
  ok(r && r.name === "InvalidBatch", "batch kosong ditolak (InvalidBatch)");
  r = await expectRevert(asRelayerA.castVotes, daftarId(2), [1]);
  ok(r && r.name === "InvalidBatch", "panjang ids dan numbers berbeda ditolak");
  r = await expectRevert(asRelayerA.castVotes, daftarId(101), Array(101).fill(1));
  ok(r && r.name === "InvalidBatch", "batch lebih dari 100 ditolak");
  r = await expectRevert(asRelayerA.castVotes, [idAcak()], [9]);
  ok(r && r.name === "InvalidCandidate" && Number(r.args[0]) === 9, "nomor paslon tidak terdaftar ditolak (InvalidCandidate)");
  ok((await contract.totalVotes()) === 0n, "tidak ada suara masuk dari semua percobaan gagal");

  console.log("\n== Mengirim suara: penghitungan ==");
  const [a, b, c] = daftarId(3);
  const rcVotes = await (await asRelayerA.castVotes([a, b, c], [1, 1, 2])).wait();
  [nums, counts] = await contract.getResults();
  ok(Array.from(counts).map(Number).join() === "2,1,0", "hitungan: paslon 1 = 2, paslon 2 = 1, paslon 3 = 0");
  ok((await contract.totalVotes()) === 3n && (await contract.votesFor(1)) === 2n, "totalVotes = 3, votesFor(1) = 2");
  const evVotes = parseEvents(contract, rcVotes).find((e) => e.name === "VotesCast");
  ok(evVotes && evVotes.args.accepted === 3n && evVotes.args.duplicates === 0n && evVotes.args.totalVotes === 3n, "event VotesCast(3 diterima, 0 ganda, total 3)");
  ok((await contract.voteCounted(a)) === true && (await contract.voteCounted(idAcak())) === false, "voteCounted: ID yang sudah dihitung tercatat");
  console.log(`         gas castVotes (3 suara): ${rcVotes.gasUsed}`);

  console.log("\n== Pengiriman ulang tidak menghitung suara dua kali ==");
  const rcUlang = await (await asRelayerA.castVotes([a, b, c], [1, 1, 2])).wait();
  const evUlang = parseEvents(contract, rcUlang).find((e) => e.name === "VotesCast");
  ok(evUlang && evUlang.args.accepted === 0n && evUlang.args.duplicates === 3n, "kirim ulang batch yang sama: 0 diterima, 3 dilewati");
  ok((await contract.totalVotes()) === 3n, "totalVotes tetap 3");
  const d = idAcak();
  const rcCampur = await (await asRelayerA.castVotes([a, d], [1, 3])).wait();
  const evCampur = parseEvents(contract, rcCampur).find((e) => e.name === "VotesCast");
  ok(evCampur && evCampur.args.accepted === 1n && evCampur.args.duplicates === 1n, "batch campuran: 1 baru diterima, 1 duplikat dilewati");
  ok((await contract.totalVotes()) === 4n && (await contract.votesFor(3)) === 1n, "totalVotes = 4, votesFor(3) = 1");

  const rcBesar = await (await asRelayerA.castVotes(daftarId(100), Array(100).fill(2))).wait();
  ok((await contract.totalVotes()) === 104n && (await contract.votesFor(2)) === 101n, "batch maksimum 100 suara diterima");
  console.log(`         gas castVotes (100 suara): ${rcBesar.gasUsed}`);

  console.log("\n== Mengganti relayer saat sesi berlangsung ==");
  const rcGanti = await (await contract.setRelayer(relayerBAddr)).wait();
  const evGanti = parseEvents(contract, rcGanti).find((e) => e.name === "RelayerChanged");
  ok(evGanti && evGanti.args.previousRelayer === relayerAAddr && evGanti.args.newRelayer === relayerBAddr, "event RelayerChanged(lama, baru) dipancarkan");
  r = await expectRevert(asRelayerA.castVotes, [idAcak()], [1]);
  ok(r && r.name === "NotRelayer", "relayer lama langsung tidak berlaku");
  await (await asRelayerB.castVotes([idAcak()], [1])).wait();
  ok((await contract.totalVotes()) === 105n, "relayer baru bisa mengirim suara");

  console.log("\n== Menutup sesi ==");
  r = await expectRevert(asOrang.closeSession);
  ok(r && r.name === "NotOwner", "wallet lain TIDAK bisa menutup sesi (NotOwner)");
  const hasilSebelum = JSON.stringify((await contract.getResults()).map((x) => Array.from(x).map(Number)));
  const rcClose = await (await contract.closeSession()).wait();
  const blockClose = await provider.getBlock(rcClose.blockNumber);
  ok((await contract.status()) === CLOSED, "status menjadi Closed");
  ok((await contract.closedBy()) === adminAddr && (await contract.closedAt()) === BigInt(blockClose.timestamp), "closedBy & closedAt tercatat");
  ok(parseEvents(contract, rcClose).some((e) => e.name === "SessionClosed"), "event SessionClosed dipancarkan");

  console.log("\n== Setelah ditutup: permanen ==");
  r = await expectRevert(asRelayerB.castVotes, [idAcak()], [1]);
  ok(r && r.name === "InvalidState" && r.args[0] === CLOSED, "suara setelah sesi ditutup ditolak");
  r = await expectRevert(contract.setRelayer, relayerAAddr);
  ok(r && r.name === "InvalidState" && r.args[0] === CLOSED, "relayer tidak bisa diganti setelah sesi ditutup");
  r = await expectRevert(contract.openSession, [1, 2, 3]);
  ok(r && r.name === "InvalidState" && r.args[0] === CLOSED, "sesi yang sudah ditutup TIDAK bisa dibuka lagi");
  r = await expectRevert(contract.closeSession);
  ok(r && r.name === "InvalidState" && r.args[0] === CLOSED, "menutup dua kali ditolak");
  const hasilSesudah = JSON.stringify((await contract.getResults()).map((x) => Array.from(x).map(Number)));
  ok(hasilSebelum === hasilSesudah, "hasil penghitungan tidak berubah setelah ditutup");

  console.log("\n== Permukaan kontrak ==");
  const ubahState = abi
    .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
    .map((f) => f.name)
    .sort()
    .join();
  ok(ubahState === "castVotes,closeSession,openSession,setRelayer", "satu-satunya fungsi pengubah state: castVotes, closeSession, openSession, setRelayer");
  ok(!abi.some((f) => f.type === "function" && /owner/i.test(f.name) && f.name !== "owner"), "tidak ada fungsi untuk mengganti owner");

  // Kecocokan ABI yang dipakai aplikasi web (js/Blockchainconfig.js) dengan hasil kompilasi
  const cfgPath = path.join(__dirname, "..", "..", "js", "Blockchainconfig.js");
  if (fs.existsSync(cfgPath)) {
    console.log("\n== Kecocokan dengan js/Blockchainconfig.js ==");
    const cfgAbi = new Function(fs.readFileSync(cfgPath, "utf8") + "; return VOTING_SESSION_ABI;")();
    const fa = new ethers.Interface(cfgAbi).fragments.map((f) => f.format("full")).sort();
    // constructor hanya dipakai saat deploy, aplikasi web tidak membutuhkannya
    const fb = new ethers.Interface(abi).fragments.filter((f) => f.type !== "constructor").map((f) => f.format("full")).sort();
    ok(JSON.stringify(fa) === JSON.stringify(fb), "ABI di aplikasi web identik dengan ABI hasil kompilasi (fungsi, event, dan error)");
    if (JSON.stringify(fa) !== JSON.stringify(fb)) {
      console.log("   hanya di aplikasi :", fa.filter((x) => !fb.includes(x)));
      console.log("   hanya di kompilasi:", fb.filter((x) => !fa.includes(x)));
    }
  }

  console.log(failed === 0 ? `\nSEMUA ${passed} PENGUJIAN LULUS` : `\n${failed} PENGUJIAN GAGAL (${passed} lulus)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});