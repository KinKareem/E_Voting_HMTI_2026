/* =========================================================
   Konfirmasi.js
   Logic untuk admin/konfirmasi.html — menyetujui/menolak
   pendaftaran mahasiswa yang berstatus "pending".
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

const contentEl = document.getElementById("konfirmasi-content");
const errorEl = document.getElementById("konfirmasi-error");

let pendingList = [];

async function loadPending() {
  contentEl.className = "empty-msg";
  contentEl.textContent = "Memuat data...";
  errorEl.className = "status-msg error hidden";

  const { data, error } = await sb
    .from("tb_pengguna")
    .select("*")
    .eq("role", "mahasiswa")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.className = "status-msg error";
    contentEl.textContent = "";
    showToast("error", "Data pendaftaran gagal dimuat.");
    return;
  }

  pendingList = data || [];
  renderTable();
}

function renderTable() {
  if (pendingList.length === 0) {
    contentEl.className = "empty-msg";
    contentEl.textContent = "Tidak ada pendaftaran yang menunggu konfirmasi saat ini.";
    return;
  }

  const rows = pendingList
    .map(
      (p) => `
      <tr data-id="${p.id}">
        <td class="strong">${escapeHtml(p.nim)}</td>
        <td>${escapeHtml(p.nama_lengkap)}</td>
        <td class="muted">${escapeHtml(p.email)}</td>
        <td class="muted">${formatDate(p.created_at)}</td>
        <td>
          <div class="action-group">
            <button class="btn-approve" data-action="approved" data-id="${p.id}">Setujui</button>
            <button class="btn-reject" data-action="rejected" data-id="${p.id}">Tolak</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");

  // innerHTML (bukan outerHTML): contentEl harus tetap menjadi wadah yang sama
  // di dalam halaman supaya render berikutnya (setelah setuju/tolak) tetap berfungsi.
  contentEl.className = "";
  contentEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>NIM</th>
          <th>Nama Lengkap</th>
          <th>Email</th>
          <th>Terdaftar</th>
          <th style="text-align:right">Aksi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleDecision(btn.dataset.id, btn.dataset.action));
  });
}

async function handleDecision(id, decision) {
  const target = pendingList.find((p) => p.id === id);
  const buttons = document.querySelectorAll(`[data-id="${id}"]`);
  buttons.forEach((b) => (b.disabled = true));

  // .select() dipakai untuk memastikan baris benar-benar berubah
  // (jika izin database menolak, Supabase tidak melempar error, hanya 0 baris).
  const { data, error } = await sb
    .from("tb_pengguna")
    .update({ status: decision })
    .eq("id", id)
    .select();

  if (error || !data || data.length === 0) {
    showToast(
      "error",
      error ? `Gagal memperbarui status: ${error.message}` : "Status tidak berubah. Pastikan Anda login sebagai admin."
    );
    buttons.forEach((b) => (b.disabled = false));
    return;
  }

  // Perbarui tampilan dulu, lalu beri tahu admin lewat toast
  pendingList = pendingList.filter((p) => p.id !== id);
  renderTable();

  const who = target ? `${target.nama_lengkap} (${target.nim})` : "Mahasiswa";
  showToast(
    "success",
    decision === "approved" ? `Pendaftaran ${who} disetujui.` : `Pendaftaran ${who} ditolak.`
  );
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) loadPending();
});