/* =========================================================
   Landing.js
   Logic untuk landing.html — halaman pemilih setelah login.

   Isi:
   1. Penjagaan akses (harus login sebagai mahasiswa yang sudah disetujui)
   2. Header: nama user yang sedang login
   3. Daftar kandidat dari tabel tb_kandidat
   4. Popup konfirmasi sebelum suara dikirim (cegah salah klik)
   5. Riwayat aktivitas admin dari tabel tb_log_admin
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

  await Promise.all([loadKandidat(), loadLog()]);
  revealSectionHeads();
  if (hasScrollTrigger) ScrollTrigger.refresh();

  setInterval(() => {
    if (!document.hidden) loadLog();
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

// Dipanggil saat awal & setelah suara berhasil dikirim
function updateVoteState() {
  const voted = profile.has_voted;

  el.statusDot.classList.toggle("voted", voted);
  el.statusText.textContent = voted
    ? "Hak suara Anda sudah digunakan"
    : "Hak suara Anda belum digunakan";
  el.votedBanner.classList.toggle("hidden", !voted);

  document.querySelectorAll(".btn-vote").forEach((btn) => {
    btn.disabled = voted;
    btn.textContent = voted
      ? "Hak suara sudah digunakan"
      : `Pilih Paslon ${formatNomor(btn.dataset.nomor)}`;
  });
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
  if (profile.has_voted) return;

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
// 5. RIWAYAT AKTIVITAS ADMIN
// =========================================================
const LOG_TYPES = {
  buka_sesi: { title: "Sesi voting telah dibuka", cls: "log-open", icon: iconUnlocked() },
  tutup_sesi: { title: "Sesi voting telah ditutup", cls: "log-close", icon: iconLocked() },
};

async function loadLog() {
  const { data, error } = await sb
    .from("tb_log_admin")
    .select("*")
    .order("waktu", { ascending: false })
    .limit(20);

  if (error) {
    if (lastLogSignature === null) {
      el.logList.innerHTML = `<li class="log-empty">Riwayat aktivitas belum dapat dimuat.</li>`;
    }
    return;
  }

  // Hindari render ulang (dan kedipan) bila data tidak berubah
  const signature = (data || []).map((d) => d.id).join("|");
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;

  if (!data || data.length === 0) {
    el.logList.innerHTML = `<li class="log-empty">Belum ada aktivitas admin. Riwayat pembukaan dan penutupan sesi voting akan muncul di sini.</li>`;
    return;
  }

  el.logList.innerHTML = data
    .map((item) => {
      const type = LOG_TYPES[item.jenis_aksi] || {
        title: item.jenis_aksi,
        cls: "log-open",
        icon: iconUnlocked(),
      };
      const wallet = item.wallet_address
        ? `<p class="log-wallet">Wallet: ${escapeHtml(truncateWallet(item.wallet_address))}</p>`
        : "";
      return `
        <li class="log-item">
          <span class="log-icon ${type.cls}">${type.icon}</span>
          <div class="log-body">
            <p class="log-title">${type.title}</p>
            <p class="log-meta">${formatWaktu(item.waktu)}</p>
            ${wallet}
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
function playIntroAnimation() {
  if (!canAnimate) return;

  gsap.from("#landing-header", { y: -70, opacity: 0, duration: 0.7, ease: "power3.out" });

  gsap
    .timeline({ defaults: { ease: "power3.out" }, delay: 0.15 })
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

// Elemen muncul (fade + geser) saat area-nya masuk layar
function animateOnScroll(targets, trigger, from = {}) {
  if (!canAnimate) return;

  const config = {
    opacity: 0,
    y: 40,
    duration: 0.7,
    ease: "power2.out",
    stagger: 0.14,
    ...from,
  };

  if (hasScrollTrigger) {
    config.scrollTrigger = { trigger, start: "top 88%", once: true };
  }

  gsap.from(targets, config);
}

// =========================================================
// HELPER
// =========================================================
function formatNomor(n) {
  return String(n).padStart(2, "0");
}

function formatWaktu(iso) {
  const d = new Date(iso);
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

function truncateWallet(address) {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
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