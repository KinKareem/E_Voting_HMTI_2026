/* =========================================================
   Listvoting.js
   Logic untuk admin/list-voting.html — menampilkan status
   voting mahasiswa, filter, pencarian, dan ekspor CSV untuk
   kebutuhan data SKP.
   ========================================================= */

// =========================================================
// NOTIFIKASI (TOAST) — slide masuk dari kanan bawah layar.
// Ditulis langsung di halaman ini, tidak bergantung pada file lain.
// Pemakaian: showToast("success" | "error" | "info", "pesan");
// Tampilannya diatur di css/style.css (bagian TOAST).
// =========================================================
function showToast(type, message) {
  let box = document.getElementById("toast-container");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast-container";
    box.className = "toast-container";
    document.body.appendChild(box);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.style.cssText = "width:18px;text-align:center;font-weight:700";
  icon.textContent = type === "success" ? "\u2713" : type === "error" ? "!" : "i";

  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = message; // textContent: aman dari HTML injection

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Tutup notifikasi");
  close.textContent = "\u00d7";

  toast.append(icon, text, close);
  box.appendChild(toast);
  while (box.children.length > 4) box.firstElementChild.remove(); // maksimal 4 sekaligus

  // Hilang otomatis; berhenti dihitung saat kursor di atas toast supaya sempat dibaca
  const dismiss = () => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 450);
  };
  let timer = setTimeout(dismiss, type === "error" ? 6500 : 4000);
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", () => {
    timer = setTimeout(dismiss, 2500);
  });
  close.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });

  // Class "toast-show" ditambahkan di frame berikutnya agar transisi slide berjalan
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-show")));
}

let allMahasiswa = [];
let currentFilter = "semua";
let currentSearch = "";

const contentWrap = document.getElementById("voting-content");
const errorEl = document.getElementById("voting-error");
const summaryEl = document.getElementById("voting-summary");

async function loadMahasiswa() {
  const { data, error } = await sb
    .from("tb_pengguna")
    .select("*")
    .eq("role", "mahasiswa")
    .eq("status", "approved")
    .order("nama_lengkap", { ascending: true });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.className = "status-msg error";
    showToast("error", "Data mahasiswa gagal dimuat.");
    return;
  }

  allMahasiswa = data || [];
  updateSummary();
  renderTable();
}

function updateSummary() {
  const sudahCount = allMahasiswa.filter((m) => m.has_voted).length;
  summaryEl.textContent = `${sudahCount} dari ${allMahasiswa.length} mahasiswa telah menggunakan hak suara.`;
}

function getFiltered() {
  const q = currentSearch.trim().toLowerCase();
  return allMahasiswa.filter((m) => {
    if (currentFilter === "sudah" && !m.has_voted) return false;
    if (currentFilter === "belum" && m.has_voted) return false;
    if (!q) return true;
    return m.nim.toLowerCase().includes(q) || m.nama_lengkap.toLowerCase().includes(q);
  });
}

function renderTable() {
  const filtered = getFiltered();

  if (filtered.length === 0) {
    contentWrap.innerHTML = `<div class="empty-msg">Tidak ada data yang cocok.</div>`;
    return;
  }

  const rows = filtered
    .map(
      (m) => `
      <tr>
        <td class="strong">${escapeHtml(m.nim)}</td>
        <td>${escapeHtml(m.nama_lengkap)}</td>
        <td>
          <span class="badge ${m.has_voted ? "voted" : "not-voted"}">
            ${m.has_voted ? "Sudah Voting" : "Belum Voting"}
          </span>
        </td>
      </tr>
    `
    )
    .join("");

  contentWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>NIM</th>
          <th>Nama Lengkap</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// --- Filter pills ---
document.getElementById("filter-pills").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-pill");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  document
    .querySelectorAll(".filter-pill")
    .forEach((p) => p.classList.toggle("active", p === btn));
  renderTable();
});

// --- Search ---
document.getElementById("search-input").addEventListener("input", (e) => {
  currentSearch = e.target.value;
  renderTable();
});

// --- Export CSV ---
document.getElementById("export-btn").addEventListener("click", () => {
  const filtered = getFiltered();
  if (filtered.length === 0) {
    showToast("info", "Tidak ada data untuk diekspor.");
    return;
  }

  const header = "NIM,Nama_Lengkap,Status_Voting";
  const rows = filtered.map(
    (m) => `${m.nim},"${m.nama_lengkap.replace(/"/g, '""')}",${m.has_voted ? "Sudah" : "Belum"}`
  );
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `data-partisipasi-skp-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  showToast("success", `${filtered.length} data berhasil diekspor ke CSV.`);
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) loadMahasiswa();
});