/* =========================================================
   Landing.js
   Logic untuk landing.html — halaman pemilih setelah login.

   Isi:
   1. Penjagaan akses (harus login sebagai mahasiswa yang sudah disetujui)
   2. Header: nama user yang sedang login
   3. Daftar kandidat dari tabel tb_kandidat
   4. Popup konfirmasi sebelum suara dikirim (cegah salah klik)
   5. Status sesi voting (tb_sesi_voting) yang menentukan apakah tombol
      "Pilih" aktif, dan riwayat buka/tutup sesi yang dibaca LANGSUNG dari
      blockchain (kontrak VotingSession) tanpa lewat server aplikasi
   6. Animasi GSAP + ScrollTrigger (otomatis dilewati jika library
      gagal dimuat atau user mengaktifkan "reduce motion")
   ========================================================= */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canAnimate = typeof gsap !== "undefined" && !prefersReducedMotion;
const hasScrollTrigger = canAnimate && typeof ScrollTrigger !== "undefined";
if (hasScrollTrigger) gsap.registerPlugin(ScrollTrigger);

const LOG_REFRESH_MS = 30000;

// State halaman
let profile = null; // baris tb_pengguna milik user yang login
let kandidatList = [];
let selectedKandidat = null;
let isSubmitting = false;
let lastFocusedEl = null;
let lastLogSignature = null;
let sesiStatus = null; // "belum_mulai" | "berlangsung" | "selesai" | null (tidak diketahui)
let chainStatusKey = null; // status sesi menurut blockchain (null jika belum terbaca)
let kandidatAnimated = false;
let logAnimated = false;

// Elemen yang sering dipakai
const el = {
  userName: document.getElementById("user-name"),
  userNim: document.getElementById("user-nim"),
  userAvatar: document.getElementById("user-avatar"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  votedBanner: document.getElementById("voted-banner"),
  sessionDot: document.getElementById("session-dot"),
  sessionText: document.getElementById("session-text"),
  sessionNotice: document.getElementById("session-notice"),
  chainNote: document.getElementById("chain-note"),
  kandidatGrid: document.getElementById("kandidat-grid"),
  kandidatError: document.getElementById("kandidat-error"),
  logList: document.getElementById("log-list"),
  overlay: document.getElementById("vote-overlay"),
  modal: document.getElementById("vote-modal"),
  viewConfirm: document.getElementById("vote-view-confirm"),
  viewSuccess: document.getElementById("vote-view-success"),
  voteNumber: document.getElementById("vote-number"),
  voteKetua: document.getElementById("vote-ketua"),
  voteWakil: document.getElementById("vote-wakil"),
  voteError: document.getElementById("vote-error"),
  btnCancel: document.getElementById("vote-cancel"),
  btnConfirm: document.getElementById("vote-confirm"),
  btnDone: document.getElementById("vote-done"),
};

// =========================================================
// 1. INISIALISASI & PENJAGAAN AKSES
// =========================================================
async function init() {
  document.getElementById("footer-year").textContent = new Date().getFullYear();

  const { data: userData } = await sb.auth.getUser();
  if (!userData || !userData.user) {
    window.location.href = "index.html";
    return;
  }

  const { data: me, error } = await sb
    .from("tb_pengguna")
    .select("*")
    .eq("id", userData.user.id)
    .single();

  if (error || !me) {
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  // Admin tidak memakai halaman pemilih
  if (me.role === "admin") {
    window.location.href = "admin/konfirmasi.html";
    return;
  }

  // Akun yang belum/tidak disetujui tidak boleh masuk
  if (me.status !== "approved") {
    await sb.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  profile = me;
  renderUser();
  updateVoteState();
  playIntroAnimation();

  await Promise.all([loadKandidat(), loadSesi(), loadLog()]);
  updateChainNote();
  revealSectionHeads();
  if (hasScrollTrigger) ScrollTrigger.refresh();

  // Segarkan status sesi & riwayat secara berkala (admin bisa membuka/menutup sesi kapan saja)
  setInterval(async () => {
    if (document.hidden) return;
    await Promise.all([loadSesi(), loadLog()]);
    updateChainNote();
  }, LOG_REFRESH_MS);
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await sb.auth.signOut();
  window.location.href = "index.html";
});

// =========================================================
// 2. HEADER & STATUS USER
// =========================================================
function renderUser() {
  el.userName.textContent = profile.nama_lengkap;
  el.userNim.textContent = `NIM ${profile.nim}`;
  el.userAvatar.textContent = profile.nama_lengkap
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
}

const SESI_INFO = {
  belum_mulai: {
    chip: "Sesi voting: belum dibuka",
    dot: "",
    button: "Sesi belum dibuka",
    notice: "Sesi voting belum dibuka. Anda dapat mempelajari profil kandidat; tombol pilih akan aktif saat panitia membuka sesi.",
  },
  berlangsung: { chip: "Sesi voting: sedang berlangsung", dot: "open", button: null, notice: null },
  selesai: {
    chip: "Sesi voting: telah ditutup",
    dot: "ended",
    button: "Sesi telah ditutup",
    notice: "Sesi voting telah ditutup. Terima kasih atas partisipasi Anda.",
  },
};
const SESI_UNKNOWN = {
  chip: "Sesi voting: tidak diketahui",
  dot: "ended",
  button: "Status sesi tidak diketahui",
  notice: "Status sesi voting tidak dapat dimuat. Muat ulang halaman ini.",
};

// Dipanggil saat awal, setelah suara terkirim, dan setiap status sesi diperbarui
function updateVoteState() {
  const voted = profile.has_voted;
  const sesi = SESI_INFO[sesiStatus] || SESI_UNKNOWN;
  const sessionOpen = sesiStatus === "berlangsung";

  // Chip status hak suara
  el.statusDot.classList.toggle("voted", voted);
  el.statusText.textContent = voted
    ? "Hak suara Anda sudah digunakan"
    : "Hak suara Anda belum digunakan";
  el.votedBanner.classList.toggle("hidden", !voted);

  // Chip & pemberitahuan status sesi
  el.sessionDot.className = `status-dot ${sesi.dot}`.trim();
  el.sessionText.textContent = sesi.chip;
  el.sessionNotice.textContent = sesi.notice || "";
  el.sessionNotice.classList.toggle("hidden", !sesi.notice);

  // Tombol pilih aktif hanya jika sesi berlangsung DAN pemilih belum memilih
  document.querySelectorAll(".btn-vote").forEach((btn) => {
    btn.disabled = voted || !sessionOpen;
    if (voted) btn.textContent = "Hak suara sudah digunakan";
    else if (!sessionOpen) btn.textContent = sesi.button;
    else btn.textContent = `Pilih Paslon ${formatNomor(btn.dataset.nomor)}`;
  });
}

// Status sesi dari database (dipakai server untuk menolak suara di luar sesi)
async function loadSesi() {
  const { data, error } = await sb.from("tb_sesi_voting").select("*").eq("id", 1).single();
  sesiStatus = error || !data ? null : data.status;
  updateVoteState();
}

// =========================================================
// 3. KANDIDAT
// =========================================================
async function loadKandidat() {
  const { data, error } = await sb
    .from("tb_kandidat")
    .select("*")
    .order("nomor_paslon", { ascending: true });

  if (error) {
    el.kandidatGrid.innerHTML = "";
    el.kandidatError.textContent = `Data kandidat gagal dimuat: ${error.message}`;
    el.kandidatError.className = "status-msg error";
    return;
  }

  kandidatList = data || [];

  if (kandidatList.length === 0) {
    el.kandidatGrid.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Kandidat belum tersedia</p>
        <p class="empty-text">Panitia belum menambahkan data pasangan calon.</p>
      </div>
    `;
    return;
  }

  el.kandidatGrid.innerHTML = kandidatList.map(kandidatCardHtml).join("");
  updateVoteState();

  if (!kandidatAnimated) {
    kandidatAnimated = true;
    animateOnScroll(el.kandidatGrid.querySelectorAll(".kandidat-card"), el.kandidatGrid);
  }
}

function fotoUrl(path) {
  return sb.storage.from("foto-kandidat").getPublicUrl(path).data.publicUrl;
}

function kandidatCardHtml(k) {
  const nomor = formatNomor(k.nomor_paslon);

  const foto = k.foto_path
    ? `<img src="${escapeAttr(fotoUrl(k.foto_path))}"
            alt="Foto paslon nomor ${nomor}: ${escapeAttr(k.nama_ketua)} dan ${escapeAttr(k.nama_wakil)}"
            loading="lazy" decoding="async" />`
    : `<div class="kandidat-photo-empty" aria-hidden="true">${personIcon()}</div>`;

  const misiItems = String(k.misi || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  const catatan = k.catatan_tambahan
    ? `<div class="kandidat-section kandidat-note">
         <h4>Catatan Tambahan</h4>
         <p>${escapeHtml(k.catatan_tambahan)}</p>
       </div>`
    : "";

  return `
    <article class="kandidat-card">
      <div class="kandidat-photo">
        ${foto}
        <div class="kandidat-number" aria-label="Nomor paslon ${k.nomor_paslon}">${nomor}</div>
      </div>
      <div class="kandidat-body">
        <p class="kandidat-role">Calon Ketua</p>
        <h3 class="kandidat-name">${escapeHtml(k.nama_ketua)}</h3>
        <p class="kandidat-role">Calon Wakil Ketua</p>
        <h3 class="kandidat-name">${escapeHtml(k.nama_wakil)}</h3>

        <div class="kandidat-section">
          <h4>Visi</h4>
          <p>${escapeHtml(k.visi)}</p>
        </div>
        <div class="kandidat-section">
          <h4>Misi</h4>
          <ul>${misiItems}</ul>
        </div>
        ${catatan}

        <div class="card-actions">
          <button type="button" class="btn-vote" data-id="${k.id}" data-nomor="${k.nomor_paslon}">
            Pilih Paslon ${nomor}
          </button>
        </div>
      </div>
    </article>
  `;
}

function personIcon() {
  return `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-4 3.4-6.4 7.5-6.4s7.5 2.4 7.5 6.4" stroke-linecap="round" />
  </svg>`;
}

// Satu listener untuk semua tombol voting (event delegation)
el.kandidatGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-vote");
  if (!btn || btn.disabled) return;
  const kandidat = kandidatList.find((k) => k.id === btn.dataset.id);
  if (kandidat) openVoteModal(kandidat, btn);
});

// =========================================================
// 4. POPUP KONFIRMASI VOTING
// =========================================================
function openVoteModal(kandidat, triggerEl) {
  if (profile.has_voted || sesiStatus !== "berlangsung") return;

  selectedKandidat = kandidat;
  lastFocusedEl = triggerEl;

  el.voteNumber.textContent = formatNomor(kandidat.nomor_paslon);
  el.voteKetua.textContent = `${kandidat.nama_ketua}`;
  el.voteWakil.textContent = `${kandidat.nama_wakil}`;

  el.viewConfirm.classList.remove("hidden");
  el.viewSuccess.classList.add("hidden");
  el.voteError.className = "status-msg error hidden";
  setSubmittingUi(false);

  el.overlay.classList.remove("hidden");

  if (canAnimate) {
    gsap.fromTo(el.overlay, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(
      el.modal,
      { y: 24, scale: 0.96, opacity: 0 },
      {
        y: 0,
        scale: 1,
        opacity: 1,
        duration: 0.3,
        ease: "power2.out",
        onComplete: () => gsap.set([el.overlay, el.modal], { clearProps: "all" }),
      }
    );
  }

  // Fokus awal ke tombol "Batal" (aksi paling aman) agar Enter tidak langsung mengirim suara
  el.btnCancel.focus();
}

function closeVoteModal() {
  if (isSubmitting) return;
  el.overlay.classList.add("hidden");
  selectedKandidat = null;
  if (lastFocusedEl) lastFocusedEl.focus();
}

function setSubmittingUi(submitting) {
  isSubmitting = submitting;
  el.btnCancel.disabled = submitting;
  el.btnConfirm.disabled = submitting;
  el.btnConfirm.textContent = submitting ? "Mengirim..." : "Ya, Kirim Suara";
}

async function submitVote() {
  if (isSubmitting || !selectedKandidat) return;

  setSubmittingUi(true);
  el.voteError.className = "status-msg error hidden";

  // Fungsi database fn_kirim_suara: menandai pemilih sudah memilih dan menyimpan
  // suara anonim dalam satu transaksi (lihat supabase/schema.sql).
  const { error } = await sb.rpc("fn_kirim_suara", { p_kandidat_id: selectedKandidat.id });

  setSubmittingUi(false);

  if (error) {
    el.voteError.textContent = error.message;
    el.voteError.className = "status-msg error";

    // Kasus: ternyata hak suara sudah terpakai (misal dari tab/perangkat lain)
    if (error.message.toLowerCase().includes("sudah menggunakan hak suara")) {
      profile.has_voted = true;
      updateVoteState();
      el.btnConfirm.disabled = true;
    }

    // Kasus: sesi ternyata sudah ditutup/belum dibuka (status berubah saat popup terbuka)
    if (error.message.toLowerCase().includes("sesi voting")) {
      await loadSesi();
      updateChainNote();
      el.btnConfirm.disabled = true;
    }
    return;
  }

  profile.has_voted = true;
  updateVoteState();

  el.viewConfirm.classList.add("hidden");
  el.viewSuccess.classList.remove("hidden");
  el.btnDone.focus();
}

el.btnCancel.addEventListener("click", closeVoteModal);
el.btnConfirm.addEventListener("click", submitVote);
el.btnDone.addEventListener("click", closeVoteModal);

// Klik di luar kotak popup = batal
el.overlay.addEventListener("click", (e) => {
  if (e.target === el.overlay) closeVoteModal();
});

document.addEventListener("keydown", (e) => {
  if (el.overlay.classList.contains("hidden")) return;

  if (e.key === "Escape") {
    closeVoteModal();
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

// =========================================================
// 5. RIWAYAT SESI DARI BLOCKCHAIN
// =========================================================
const LOG_TYPES = {
  buka_sesi: { title: "Sesi voting telah dibuka", cls: "log-open", icon: iconUnlocked() },
  tutup_sesi: { title: "Sesi voting telah ditutup", cls: "log-close", icon: iconLocked() },
};

function renderLogMessage(text) {
  el.logList.innerHTML = `<li class="log-empty">${escapeHtml(text)}</li>`;
}

// Riwayat dibaca langsung dari kontrak lewat RPC publik, BUKAN dari database aplikasi,
// sehingga tidak bisa diubah-ubah oleh pengelola server.
async function loadLog() {
  const problem = blockchainConfigProblem();
  if (problem) {
    lastLogSignature = "tidak-dikonfigurasi";
    chainStatusKey = null;
    renderLogMessage(
      blockchainConfigCode() === "no_address"
        ? "Kontrak blockchain belum dikonfigurasi oleh panitia."
        : "Riwayat tidak dapat dimuat dari blockchain saat ini."
    );
    return;
  }

  let state;
  try {
    state = await readSessionState(getSessionContract());
  } catch (e) {
    chainStatusKey = null;
    if (lastLogSignature === null) {
      renderLogMessage("Riwayat belum dapat dimuat dari blockchain. Coba muat ulang halaman.");
    }
    return;
  }
  chainStatusKey = state.statusKey;

  // Entri terbaru di atas
  const entries = [];
  if (state.closedAt) entries.push({ jenis: "tutup_sesi", at: state.closedAt, wallet: state.closedBy });
  if (state.openedAt) entries.push({ jenis: "buka_sesi", at: state.openedAt, wallet: state.openedBy });

  // Hindari render ulang (dan kedipan) bila data tidak berubah
  const signature = entries.map((x) => `${x.jenis}:${x.at}`).join("|") || "kosong";
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;

  if (entries.length === 0) {
    renderLogMessage("Belum ada aktivitas. Pembukaan dan penutupan sesi voting akan muncul di sini.");
    return;
  }

  el.logList.innerHTML = entries
    .map((item) => {
      const type = LOG_TYPES[item.jenis];
      return `
        <li class="log-item">
          <span class="log-icon ${type.cls}">${type.icon}</span>
          <div class="log-body">
            <p class="log-title">${type.title}</p>
            <p class="log-meta">${formatChainTime(item.at)}</p>
            <p class="log-wallet">Wallet: ${escapeHtml(shortAddress(item.wallet))}</p>
          </div>
        </li>
      `;
    })
    .join("");

  if (!logAnimated) {
    logAnimated = true;
    animateOnScroll(el.logList.querySelectorAll(".log-item"), el.logList, { x: -24, y: 0 });
  }
}

// Membandingkan status sesi di database aplikasi dengan blockchain.
// Jika berbeda, pemilih diberi tahu (tanda kemungkinan data tidak konsisten).
function updateChainNote() {
  if (!chainStatusKey || !sesiStatus) {
    el.chainNote.className = "chain-note hidden";
    return;
  }
  if (chainStatusKey === sesiStatus) {
    el.chainNote.className = "chain-note ok";
    el.chainNote.textContent = "Status sesi di aplikasi sesuai dengan catatan di blockchain.";
  } else {
    el.chainNote.className = "chain-note warn";
    el.chainNote.textContent =
      "Peringatan: status sesi di aplikasi berbeda dengan catatan blockchain. Hubungi panitia sebelum memilih.";
  }
}

function iconUnlocked() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 017.5-2" stroke-linecap="round" />
  </svg>`;
}

function iconLocked() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" stroke-linecap="round" />
  </svg>`;
}

// =========================================================
// 6. ANIMASI (GSAP)
// =========================================================
// Setelah animasi selesai, style inline buatan GSAP dibuang supaya efek hover CSS
// (properti `translate`) berfungsi kembali dan posisi akhir ditentukan CSS.
const CLEAR_PROPS = "transform,translate,rotate,scale,opacity";

function playIntroAnimation() {
  if (!canAnimate) return;

  gsap.from("#landing-header", {
    y: -70,
    opacity: 0,
    duration: 0.7,
    ease: "power3.out",
    clearProps: CLEAR_PROPS,
  });

  gsap
    .timeline({ defaults: { ease: "power3.out", clearProps: CLEAR_PROPS }, delay: 0.15 })
    .from(".hero-eyebrow", { y: 20, opacity: 0, duration: 0.6 })
    .from(".hero-title", { y: 34, opacity: 0, duration: 0.85 }, "-=0.3")
    .from(".hero-text", { y: 22, opacity: 0, duration: 0.65 }, "-=0.45")
    .from(".hero-actions > *", { y: 18, opacity: 0, duration: 0.55, stagger: 0.12 }, "-=0.35");

  // Lingkaran dekoratif berputar sangat pelan
  gsap.to(".hero-ring", { rotation: 360, duration: 90, repeat: -1, ease: "none" });
}

function revealSectionHeads() {
  document.querySelectorAll("[data-reveal]").forEach((node) => animateOnScroll(node, node));
}

function animateOnScroll(targets, trigger, from = {}) {
  if (!canAnimate) return;

  const fromVars = { opacity: 0, y: 40, ...from };
  const toVars = {
    opacity: 1,
    x: 0,
    y: 0,
    duration: 0.7,
    ease: "power2.out",
    stagger: 0.14,
    clearProps: CLEAR_PROPS,
  };

  if (hasScrollTrigger) {
    toVars.scrollTrigger = { trigger, start: "top 88%", once: true };
  }

  gsap.fromTo(targets, fromVars, toVars);
}

// HELPER
function formatNomor(n) {
  return String(n).padStart(2, "0");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Untuk nilai di dalam atribut HTML (escapeHtml tidak meng-escape tanda kutip)
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

init();