/* =========================================================
   Tambahsiswa.js
   Logic untuk admin/tambah-siswa.html — mengunggah file CSV
   dan melakukan bulk insert ke tabel tb_mahasiswa.
   Menggunakan library PapaParse (lewat CDN) untuk parsing CSV.
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

const REQUIRED_COLUMNS = ["nim", "nama_lengkap", "prodi", "angkatan"];

let parsedRows = [];

const csvInput = document.getElementById("csv-input");
const dzTitle = document.getElementById("dz-title");
const parseErrorEl = document.getElementById("parse-error");
const previewCard = document.getElementById("preview-card");
const previewContent = document.getElementById("preview-content");
const previewCount = document.getElementById("preview-count");
const previewNote = document.getElementById("preview-note");
const importBtn = document.getElementById("import-btn");

csvInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  parseErrorEl.className = "status-msg error hidden";
  dzTitle.textContent = file.name;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    complete: (res) => {
      const columns = res.meta.fields || [];
      const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));

      if (missing.length > 0) {
        parseErrorEl.textContent = `Kolom CSV tidak sesuai format. Kolom yang wajib ada: ${REQUIRED_COLUMNS.join(
          ", "
        )}. Kolom hilang: ${missing.join(", ")}.`;
        parseErrorEl.className = "status-msg error";
        parsedRows = [];
        previewCard.className = "table-card hidden";
        showToast("error", "Format CSV tidak sesuai. Periksa kolom pada file Anda.");
        return;
      }

      parsedRows = res.data
        .filter((r) => r.nim && r.nim.trim() !== "")
        .map((r) => ({
          nim: r.nim.trim(),
          nama_lengkap: (r.nama_lengkap || "").trim(),
          prodi: (r.prodi || "").trim(),
          angkatan: (r.angkatan || "").trim(),
        }));

      renderPreview();
      if (parsedRows.length > 0) {
        showToast("success", `File "${file.name}" terbaca: ${parsedRows.length} baris siap diimpor.`);
      } else {
        showToast("error", "File CSV tidak berisi data mahasiswa.");
      }
    },
    error: (err) => {
      parseErrorEl.textContent = err.message;
      parseErrorEl.className = "status-msg error";
      showToast("error", "File CSV gagal dibaca.");
    },
  });
});

function renderPreview() {
  if (parsedRows.length === 0) {
    previewCard.className = "table-card hidden";
    return;
  }

  previewCard.className = "table-card";
  previewCount.textContent = `Pratinjau — ${parsedRows.length} baris siap diimpor`;

  const rowsToShow = parsedRows.slice(0, 50);
  const rowsHtml = rowsToShow
    .map(
      (r) => `
      <tr>
        <td class="strong">${escapeHtml(r.nim)}</td>
        <td>${escapeHtml(r.nama_lengkap)}</td>
        <td class="muted">${escapeHtml(r.prodi)}</td>
        <td class="muted">${escapeHtml(r.angkatan)}</td>
      </tr>
    `
    )
    .join("");

  previewContent.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>NIM</th>
          <th>Nama Lengkap</th>
          <th>Prodi</th>
          <th>Angkatan</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  if (parsedRows.length > 50) {
    previewNote.textContent = `Menampilkan 50 dari ${parsedRows.length} baris. Semua baris tetap akan diimpor.`;
    previewNote.className = "preview-note";
  } else {
    previewNote.className = "preview-note hidden";
  }
}

importBtn.addEventListener("click", async () => {
  if (parsedRows.length === 0) return;

  importBtn.disabled = true;
  importBtn.textContent = "Mengimpor...";

  const { error, count } = await sb
    .from("tb_mahasiswa")
    .upsert(parsedRows, { onConflict: "nim", count: "exact" });

  importBtn.disabled = false;
  importBtn.textContent = "Impor ke Database";

  if (error) {
    showToast("error", `Impor gagal: ${error.message}`);
    return;
  }

  showToast("success", `Berhasil memasukkan ${count ?? parsedRows.length} data mahasiswa.`);

  parsedRows = [];
  previewCard.className = "table-card hidden";
  dzTitle.textContent = "Klik untuk memilih file CSV";
  csvInput.value = "";
});

document.getElementById("download-template-btn").addEventListener("click", () => {
  const template =
    "nim,nama_lengkap,prodi,angkatan\n2305551001,Contoh Nama Mahasiswa,Teknologi Informasi,2023\n";
  const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "template-mahasiswa.csv";
  link.click();
  URL.revokeObjectURL(url);
  showToast("info", "Template CSV diunduh.");
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}