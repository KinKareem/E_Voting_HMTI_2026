/* =========================================================
   Hasilvoting.js
   Logic untuk admin/hasil-voting.html — peragaan hasil pemilihan
   untuk acara pengumuman.

   Alur:
   1. Hasil dibaca LANGSUNG dari smart contract (getResults), sama seperti
      halaman depan. Nama & foto kandidat dari tabel tb_kandidat.
   2. Tombol "Lihat Hasil Pemilihan" baru aktif setelah sesi ditutup
      (status kontrak = 2) dan ada suara yang tercatat.
   3. Saat tombol ditekan, tiap kandidat diungkap satu per satu dari
      perolehan SUARA TERSEDIKIT sampai TERBANYAK: batang naik dari bawah
      (angka ikut berhitung), lalu foto dan namanya muncul.
   4. Terakhir pemenang disorot. Jika perolehan tertinggi sama (seri),
      tidak ada pemenang tunggal dan layar menyatakan hasil seri.

   Sebelum tombol ditekan, panggung hanya berisi tanda "?" sehingga hasil
   tidak bocor ke penonton.

   Tampilan & animasi diatur di css/style.css (bagian HASIL VOTING).
   ========================================================= */

const BUCKET_FOTO = "foto-kandidat";
const POLL_MS = 10000; // memeriksa ulang status sesi selama belum ditutup

// Jadwal animasi (milidetik)
const T = {
  awal: 900, // jeda setelah tombol ditekan
  bar: 2600, // lama batang naik (angka berhitung selama ini juga)
  setelahBar: 450, // jeda setelah batang selesai, sebelum foto muncul
  kartu: 1000, // lama foto & nama muncul
  antar: 1500, // jeda sebelum kandidat berikutnya
  ketegangan: 2800, // jeda sebelum kandidat teratas diungkap
  pemenang: 1400, // jeda sebelum pemenang disorot
};

const reduceMotion =
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SKALA = reduceMotion ? 0.25 : 1; // pengguna yang mematikan animasi: urutan sama, jauh lebih singkat

const el = {
  subtitle: document.getElementById("hv-subtitle"),
  status: document.getElementById("hv-status"),
  stage: document.getElementById("hv-stage"),
  caption: document.getElementById("hv-caption"),
  chart: document.getElementById("hv-chart"),
  banner: document.getElementById("hv-banner"),
  bannerEyebrow: document.getElementById("hv-banner-eyebrow"),
  bannerTitle: document.getElementById("hv-banner-title"),
  bannerText: document.getElementById("hv-banner-text"),
  startWrap: document.getElementById("hv-start-wrap"),
  btnStart: document.getElementById("hv-start"),
  btnReplay: document.getElementById("hv-replay"),
  btnFs: document.getElementById("hv-fs"),
};

// State halaman
let hasil = null; // hasil yang sudah disusun (lihat susunHasil); null bila belum siap
let sedangMain = false;
let pollTimer = null;
let sudahDisiapkan = false;

// =========================================================
// PERHITUNGAN (murni, tanpa DOM)
// =========================================================

// Menyusun hasil dari kontrak + data kandidat.
// Urutan `urut`: suara TERSEDIKIT -> TERBANYAK; suara sama diurutkan menurut nomor paslon.
function susunHasil(numbers, counts, kandidat) {
  const total = counts.reduce((a, b) => a + b, 0);
  const items = numbers.map((nomor, i) => {
    const k = (kandidat || []).find((x) => Number(x.nomor_paslon) === Number(nomor));
    const suara = Number(counts[i]);
    return {
      nomor: Number(nomor),
      suara,
      persen: total > 0 ? (suara / total) * 100 : 0,
      nama: k ? k.nama_ketua : null,
      fotoPath: k ? k.foto_path : null,
    };
  });
  items.sort((a, b) => a.suara - b.suara || a.nomor - b.nomor);

  const tertinggi = items.length ? Math.max(...items.map((x) => x.suara)) : 0;
  const teratas = tertinggi > 0 ? items.filter((x) => x.suara === tertinggi) : [];
  return {
    urut: items,
    total,
    tertinggi,
    pemenang: teratas.length === 1 ? teratas[0] : null,
    seri: teratas.length > 1 ? teratas : null,
  };
}

function formatPersen(p) {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

function formatNomor(n) {
  return String(n).padStart(2, "0");
}

function labelPaslon(item) {
  return `Paslon ${formatNomor(item.nomor)}`;
}

function namaKandidat(item) {
  return item.nama || labelPaslon(item);
}

// Tinggi batang (persen dari tinggi maksimum): terbanyak = 100%. Suara 0 tetap tampak sebagai garis tipis.
function tinggiBatang(suara, tertinggi) {
  if (!(tertinggi > 0)) return 0;
  return Math.max((suara / tertinggi) * 100, suara > 0 ? 4 : 1.5);
}

// =========================================================
// DATA
// =========================================================
function fotoUrl(path) {
  return sb.storage.from(BUCKET_FOTO).getPublicUrl(path).data.publicUrl;
}

// Membaca status sesi + hasil dari blockchain dan data kandidat dari database.
// Mengembalikan { status: "masalah" | "belum_mulai" | "berlangsung" | "siap", ... }
async function muatData() {
  await muatAlamatKontrak();
  const problem = blockchainConfigProblem();
  if (problem) return { status: "masalah", pesan: problem };

  let state;
  try {
    state = await readSessionState(getSessionContract());
  } catch (e) {
    return { status: "masalah", pesan: `Tidak dapat membaca status sesi dari blockchain. ${describeChainError(e).message}` };
  }
  if (state.status === 0) return { status: "belum_mulai" };
  if (state.status === 1) return { status: "berlangsung" };

  let r;
  try {
    r = await readResults(getSessionContract());
  } catch (e) {
    return { status: "masalah", pesan: `Tidak dapat membaca hasil dari blockchain. ${describeChainError(e).message}` };
  }

  const { data: kandidat, error } = await sb
    .from("tb_kandidat")
    .select("nomor_paslon, nama_ketua, foto_path")
    .order("nomor_paslon", { ascending: true });
  if (error) return { status: "masalah", pesan: `Gagal memuat data kandidat: ${error.message}` };

  return { status: "siap", ...susunHasil(r.numbers, r.counts, kandidat) };
}

// =========================================================
// TAMPILAN
// =========================================================
function buatEl(tag, kelas, teks) {
  const e = document.createElement(tag);
  if (kelas) e.className = kelas;
  if (teks !== undefined) e.textContent = teks;
  return e;
}

function ikonOrang() {
  const wrap = buatEl("span", "hv-photo-empty");
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = `<svg width="56%" height="56%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-4 3.4-6.4 7.5-6.4s7.5 2.4 7.5 6.4" stroke-linecap="round" />
  </svg>`;
  return wrap;
}

function ikonMahkota() {
  const wrap = buatEl("span", "hv-crown");
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = `<svg width="38" height="30" viewBox="0 0 38 30" fill="currentColor">
    <path d="M3 24 0 6l10 8L19 0l9 14L38 6l-3 18z" />
    <rect x="3" y="26" width="32" height="4" rx="1.5" />
  </svg>`;
  return wrap;
}

function setStatus(jenis, teks) {
  if (!teks) {
    el.status.className = "status-msg info hidden";
    el.status.textContent = "";
    return;
  }
  el.status.className = `status-msg ${jenis}`;
  el.status.textContent = teks;
}

// Membuat satu kolom (batang + kartu foto/nama + angka). Isinya TERSEMBUNYI sampai diungkap.
function buatSlot(item) {
  const slot = buatEl("div", "hv-slot");
  slot.dataset.nomor = String(item.nomor);

  const area = buatEl("div", "hv-bar-area");
  const bar = buatEl("div", "hv-bar");

  const kartu = buatEl("div", "hv-card");
  const foto = buatEl("div", "hv-photo");
  if (item.fotoPath) {
    const img = document.createElement("img");
    img.alt = `Foto ${namaKandidat(item)}`;
    img.decoding = "async";
    img.addEventListener("error", () => {
      img.replaceWith(ikonOrang());
    });
    img.src = fotoUrl(item.fotoPath);
    foto.append(img);
  } else {
    foto.append(ikonOrang());
  }
  kartu.append(ikonMahkota(), foto, buatEl("p", "hv-nomor", labelPaslon(item)), buatEl("p", "hv-nama", namaKandidat(item)));
  bar.append(kartu);
  area.append(bar);

  const kaki = buatEl("div", "hv-foot");
  const tanya = buatEl("div", "hv-q", "?");
  tanya.setAttribute("aria-hidden", "true");
  const stat = buatEl("div", "hv-stat");
  const num = buatEl("strong", "hv-num", "0");
  stat.append(num, buatEl("span", "hv-unit", " suara"), buatEl("span", "hv-pct", ""));
  kaki.append(tanya, stat);

  slot.append(area, kaki);
  return slot;
}

// Mengosongkan panggung dan menyiapkan kolom kosong (tanda "?") sebanyak kandidat.
function siapkanPanggung() {
  el.chart.replaceChildren();
  el.chart.style.setProperty("--hv-dur", `${Math.round(T.bar * SKALA)}ms`);
  el.stage.classList.remove("selesai", "ada-juara");
  el.stage.querySelectorAll(".hv-confetti").forEach((n) => n.remove());
  el.banner.classList.remove("tampil");
  el.bannerEyebrow.textContent = "";
  el.bannerTitle.textContent = "";
  el.bannerText.textContent = "";
  el.caption.textContent = "";
  if (hasil) hasil.urut.forEach((item) => el.chart.append(buatSlot(item)));
  sudahDisiapkan = true;
}

function updateKontrol() {
  const siap = !!hasil && hasil.total > 0;
  const selesai = el.stage.classList.contains("selesai");
  el.btnStart.disabled = !siap || sedangMain;
  el.startWrap.classList.toggle("pudar", sedangMain || selesai); // tombol mulai memudar saat animasi berjalan
  el.btnReplay.classList.toggle("hidden", !selesai || sedangMain);
  el.btnReplay.disabled = sedangMain;
}

function tampilkanKeadaan(data) {
  hasil = null;
  el.chart.replaceChildren();
  sudahDisiapkan = false;
  el.caption.textContent = "";
  el.banner.classList.remove("tampil");

  if (data.status === "masalah") {
    el.subtitle.textContent = "Hasil belum dapat ditampilkan.";
    setStatus("error", data.pesan);
  } else if (data.status === "belum_mulai") {
    el.subtitle.textContent = "Sesi voting belum dimulai.";
    setStatus("info", "Hasil baru dapat ditampilkan setelah sesi voting dibuka dan ditutup (menu Sesi Voting).");
  } else if (data.status === "berlangsung") {
    el.subtitle.textContent = "Sesi voting masih berlangsung.";
    setStatus("info", "Hasil baru dapat ditampilkan setelah sesi voting ditutup. Halaman ini memeriksa ulang otomatis.");
  } else if (data.total === 0) {
    el.subtitle.textContent = "Sesi voting telah ditutup.";
    setStatus("info", "Sesi sudah ditutup, tetapi belum ada suara yang tercatat di blockchain.");
  } else {
    hasil = data;
    el.subtitle.textContent = "Sesi voting telah ditutup. Hasil siap ditampilkan.";
    setStatus("info", "");
    siapkanPanggung();
    el.caption.textContent = "Hasil Pemilihan Ketua HMTI";
  }
  el.stage.classList.toggle("hidden", !hasil); // panggung hanya tampil bila hasil siap diperagakan
  updateKontrol();
}

// =========================================================
// ANIMASI
// =========================================================
function tunggu(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SKALA)));
}

// Angka berhitung dari 0 sampai target selama `durasi` ms (melambat di akhir, mengikuti batang).
function hitungNaik(node, target, durasi) {
  return new Promise((resolve) => {
    const total = Math.max(0, durasi * SKALA);
    if (total === 0 || typeof requestAnimationFrame !== "function") {
      node.textContent = String(target);
      resolve();
      return;
    }
    const mulai = performance.now();
    const langkah = (sekarang) => {
      const t = Math.min(1, (sekarang - mulai) / total);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(langkah);
      else {
        node.textContent = String(target);
        resolve();
      }
    };
    requestAnimationFrame(langkah);
  });
}

function slotUntuk(item) {
  return el.chart.querySelector(`.hv-slot[data-nomor="${item.nomor}"]`);
}

// Mengungkap satu kandidat: batang naik + angka berhitung, lalu foto & nama muncul.
async function ungkap(item) {
  const slot = slotUntuk(item);
  if (!slot) return;
  const bar = slot.querySelector(".hv-bar");
  const num = slot.querySelector(".hv-num");
  const pct = slot.querySelector(".hv-pct");

  slot.classList.add("naik"); // tanda "?" diganti angka
  void bar.offsetHeight; // pastikan transisi dimulai dari tinggi 0
  bar.style.height = `${tinggiBatang(item.suara, hasil.tertinggi)}%`;

  await Promise.all([hitungNaik(num, item.suara, T.bar), tunggu(T.bar)]);
  pct.textContent = formatPersen(item.persen);
  await tunggu(T.setelahBar);

  slot.classList.add("tampil"); // foto & nama
  await tunggu(T.kartu);
}

function hujanKonfeti() {
  if (reduceMotion) return;
  const warna = ["#ffe29a", "#deab57", "#e2983a", "#f4f1ef", "#8d5815"];
  for (let i = 0; i < 80; i++) {
    const s = buatEl("span", "hv-confetti");
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = warna[i % warna.length];
    s.style.animationDelay = `${(Math.random() * 1.4).toFixed(2)}s`;
    s.style.animationDuration = `${(3 + Math.random() * 2.5).toFixed(2)}s`;
    s.style.setProperty("--dx", `${Math.round(Math.random() * 180 - 90)}px`);
    el.stage.append(s);
    setTimeout(() => s.remove(), 8000);
  }
}

// Sorotan akhir: pemenang tunggal, atau pernyataan seri.
async function umumkan() {
  const h = hasil;
  if (h.pemenang) {
    const w = h.pemenang;
    slotUntuk(w).classList.add("juara");
    el.stage.classList.add("ada-juara");
    el.bannerEyebrow.textContent = "Pemenang Pemilihan Ketua HMTI";
    el.bannerTitle.textContent = `Selamat kepada ${namaKandidat(w)}!`;
    el.bannerText.textContent =
      `${labelPaslon(w)} · ${w.suara} suara (${formatPersen(w.persen)}) · ` +
      `Total ${h.total} suara tercatat di blockchain`;
    hujanKonfeti();
  } else {
    h.seri.forEach((x) => slotUntuk(x).classList.add("seri"));
    const daftar = h.seri.map((x) => `${labelPaslon(x)} (${namaKandidat(x)})`).join(" dan ");
    el.bannerEyebrow.textContent = "Hasil Pemilihan Ketua HMTI";
    el.bannerTitle.textContent = "Hasil seri";
    el.bannerText.textContent =
      `Perolehan tertinggi sama, ${h.tertinggi} suara, antara ${daftar}. ` +
      `Tidak ada pemenang tunggal; tentukan tindak lanjutnya sesuai ketentuan panitia. ` +
      `Total ${h.total} suara tercatat di blockchain.`;
  }
  el.banner.classList.add("tampil");
}

async function mainkan() {
  if (sedangMain || !hasil || hasil.total === 0) return;
  sedangMain = true;
  siapkanPanggung(); // mulai dari kondisi bersih (juga untuk putar ulang)
  updateKontrol();
  // Di luar layar penuh, geser halaman agar panggung terlihat utuh selama animasi
  if (!document.fullscreenElement && typeof el.stage.scrollIntoView === "function") {
    el.stage.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  el.caption.textContent = "Menghitung perolehan suara...";

  try {
    await tunggu(T.awal);
    let masukTeratas = false;
    for (const item of hasil.urut) {
      if (!masukTeratas && item.suara === hasil.tertinggi) {
        // Kandidat dengan perolehan tertinggi: beri jeda dramatis lebih dulu
        masukTeratas = true;
        el.caption.textContent = hasil.pemenang ? "Dan pemenangnya adalah..." : "Perolehan suara tertinggi...";
        el.chart.classList.add("tegang");
        await tunggu(T.ketegangan);
        el.chart.classList.remove("tegang");
      }
      await ungkap(item);
      if (item !== hasil.urut[hasil.urut.length - 1]) await tunggu(T.antar);
    }
    await tunggu(T.pemenang);
    await umumkan();
    el.stage.classList.add("selesai");
  } finally {
    sedangMain = false;
    el.chart.classList.remove("tegang");
    updateKontrol();
  }
}

// =========================================================
// LAYAR PENUH (untuk ditampilkan di proyektor)
// =========================================================
function updateTombolLayar() {
  const aktif = document.fullscreenElement === el.stage;
  el.btnFs.textContent = aktif ? "Keluar layar penuh" : "Layar penuh";
}

async function alihkanLayarPenuh() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el.stage.requestFullscreen();
  } catch (e) {
    showToastSafe("Layar penuh tidak dapat diaktifkan di browser ini.");
  }
}

function showToastSafe(pesan) {
  if (typeof showToast === "function") showToast("error", pesan);
  else setStatus("error", pesan);
}

// =========================================================
// PEMUATAN & PEMERIKSAAN ULANG
// =========================================================
async function muatDanTampilkan() {
  if (sedangMain) return;
  let data;
  try {
    data = await muatData();
  } catch (e) {
    data = { status: "masalah", pesan: `Terjadi kesalahan: ${(e && e.message) || e}` };
  }
  if (sedangMain) return; // animasi dimulai selagi memuat; jangan ganggu
  // Hasil yang sudah siap tidak diganti saat pemeriksaan ulang (hasil kontrak yang ditutup bersifat final)
  if (data.status === "siap" && hasil && sudahDisiapkan && el.stage.classList.contains("selesai")) return;
  tampilkanKeadaan(data);

  if (data.status === "siap" || data.status === "masalah") stopPoll();
  else startPoll();
}

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(muatDanTampilkan, POLL_MS);
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

el.btnStart.addEventListener("click", mainkan);
el.btnReplay.addEventListener("click", mainkan);
if (document.fullscreenEnabled) {
  el.btnFs.classList.remove("hidden");
  el.btnFs.addEventListener("click", alihkanLayarPenuh);
  document.addEventListener("fullscreenchange", updateTombolLayar);
}

(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) muatDanTampilkan();
});
