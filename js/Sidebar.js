/* =========================================================
   Sidebar.js
   Merender sidebar admin ke dalam <div id="sidebar-root"></div>
   yang ada di setiap halaman dashboard admin (konfirmasi.html,
   list-voting.html, tambah-siswa.html). Juga menangani toggle
   menu mobile dan tombol logout.
   ========================================================= */

const MENU_ITEMS = [
  { href: "konfirmasi.html", label: "Konfirmasi Pendaftaran" },
  { href: "kandidat.html", label: "Kandidat" },
  { href: "list-voting.html", label: "List Voting" },
  { href: "tambah-siswa.html", label: "Tambah Siswa" },
];

function renderSidebar() {
  const currentPage = window.location.pathname.split("/").pop();

  const menuHtml = MENU_ITEMS.map((item) => {
    const isActive = item.href === currentPage;
    return `
      <a href="${item.href}" class="sidebar-link ${isActive ? "active" : ""}">
        ${iconFor(item.href)}
        ${item.label}
      </a>
    `;
  }).join("");

  const sidebarHtml = `
    <button type="button" class="mobile-menu-btn" id="mobile-menu-btn" aria-label="Buka menu">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round" />
      </svg>
    </button>

    <div class="sidebar-overlay" id="sidebar-overlay"></div>

    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <p class="sidebar-eyebrow">E-Voting HMTI</p>
        <p class="sidebar-title">Panel Admin</p>
      </div>
      <div class="sidebar-rule"></div>

      <nav class="sidebar-nav">
        ${menuHtml}
      </nav>

      <div class="sidebar-footer">
        <button type="button" class="sidebar-logout" id="sidebar-logout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M9 4H5a2 2 0 00-2 2v12a2 2 0 002 2h4" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M16 17l5-5-5-5M21 12H9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Keluar
        </button>
      </div>
    </aside>
  `;

  document.getElementById("sidebar-root").innerHTML = sidebarHtml;

  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const menuBtn = document.getElementById("mobile-menu-btn");

  menuBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    overlay.classList.add("visible");
  });

  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("visible");
  });

  document.getElementById("sidebar-logout").addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "../admin.html";
  });
}

function iconFor(href) {
  if (href === "konfirmasi.html") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" stroke-linecap="round" />
      <path d="M16.5 11.5l1.7 1.7 3-3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
  }
  if (href === "kandidat.html") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3 20c0-3.4 2.6-5.6 6-5.6s6 2.2 6 5.6" stroke-linecap="round" />
      <path d="M16 14.6c2.7 0 5 1.8 5 4.9" stroke-linecap="round" />
    </svg>`;
  }
  if (href === "list-voting.html") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M8 6h13M8 12h13M8 18h13" stroke-linecap="round" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round" />
    </svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

// ---------------------------------------------------------
// Penjagaan akses: seluruh halaman dashboard hanya untuk admin yang sedang
// login dan berstatus approved. Tanpa pemeriksaan ini, sesi yang hilang/habis
// membuat halaman tampil KOSONG tanpa pesan apa pun (database hanya mengembalikan
// daftar kosong, bukan error), sehingga data seolah-olah tidak ada.
//
// Hasilnya (Promise<boolean>) disimpan di window.adminReady. Halaman menunggu
// ini sebelum memuat datanya, dan yang gagal otomatis dikirim ke halaman login.
// ---------------------------------------------------------
async function guardAdmin() {
  const goToLogin = () => {
    window.location.href = "../admin.html?sesi=habis";
    return false;
  };

  const { data } = await sb.auth.getUser();
  if (!data || !data.user) return goToLogin();

  const { data: me, error } = await sb
    .from("tb_pengguna")
    .select("role, status")
    .eq("id", data.user.id)
    .single();

  if (error || !me || me.role !== "admin" || me.status !== "approved") {
    await sb.auth.signOut();
    return goToLogin();
  }
  return true;
}

window.adminReady = guardAdmin();
renderSidebar();