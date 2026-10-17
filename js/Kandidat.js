/* =========================================================
   Kandidat.js
   Logic untuk admin/kandidat.html:
   - menampilkan card kandidat dari tabel tb_kandidat
   - form tambah & edit kandidat (termasuk upload foto)
   - hapus kandidat dengan popup konfirmasi
   - notifikasi hasil tindakan lewat showToast() (ada di bagian atas file ini)

   Foto disimpan di Supabase Storage (bucket "foto-kandidat"),
   sedangkan lokasi filenya dicatat di kolom tb_kandidat.foto_path.
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

const BUCKET = "foto-kandidat";
const MAX_FOTO_BYTES = 2 * 1024 * 1024; // 2 MB (sama dengan batas bucket di schema.sql)
const FOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const gridEl = document.getElementById("kandidat-grid");
const openBtn = document.getElementById("open-form-btn");

// Form tambah/edit
const overlayEl = document.getElementById("form-overlay");
const formEl = document.getElementById("kandidat-form");
const formTitleEl = document.getElementById("form-title");
const formErrorEl = document.getElementById("form-error");
const submitBtn = document.getElementById("form-submit");
const cancelBtn = document.getElementById("form-cancel");
const fotoInput = document.getElementById("f-foto");
const fotoPreviewEl = document.getElementById("foto-preview");
const fotoRemoveBtn = document.getElementById("foto-remove");

// Popup hapus
const deleteOverlayEl = document.getElementById("delete-overlay");
const deleteTextEl = document.getElementById("delete-text");
const deleteErrorEl = document.getElementById("delete-error");
const deleteCancelBtn = document.getElementById("delete-cancel");
const deleteConfirmBtn = document.getElementById("delete-confirm");

let kandidatList = [];
let editingKandidat = null; // null = mode tambah
let selectedFile = null; // foto baru yang dipilih di form
let removeExistingFoto = false; // admin menekan "Hapus foto" saat edit
let previewObjectUrl = null;
let deleteTarget = null;
let isSaving = false;
let isDeleting = false;
let lastFocusedEl = null;

// ---------------------------------------------------------
// Memuat & menampilkan daftar kandidat
// ---------------------------------------------------------
async function loadKandidat() {
  const { data, error } = await sb
    .from("tb_kandidat")
    .select("*")
    .order("nomor_paslon", { ascending: true });

  if (error) {
    gridEl.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Data kandidat gagal dimuat</p>
        <p class="empty-text">${escapeHtml(error.message)}</p>
      </div>
    `;
    showToast("error", "Data kandidat gagal dimuat.");
    return;
  }

  kandidatList = data || [];
  renderGrid();
}

function renderGrid() {
  if (kandidatList.length === 0) {
    gridEl.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">Belum ada kandidat</p>
        <p class="empty-text">Klik tombol "Tambah Kandidat" untuk menambahkan pasangan calon pertama.</p>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = kandidatList.map(kandidatCardHtml).join("");
}

function fotoUrl(path) {
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function kandidatCardHtml(k) {
  const nomor = String(k.nomor_paslon).padStart(2, "0");

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
          <button type="button" class="btn-outline btn-edit" data-id="${k.id}">Edit</button>
          <button type="button" class="btn-danger btn-delete" data-id="${k.id}">Hapus</button>
        </div>
      </div>
    </article>
  `;
}

// Satu listener untuk semua tombol Edit/Hapus di card (event delegation)
gridEl.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".btn-edit");
  const deleteBtn = e.target.closest(".btn-delete");
  if (editBtn) {
    const k = kandidatList.find((item) => item.id === editBtn.dataset.id);
    if (k) openForm(k, editBtn);
  } else if (deleteBtn) {
    const k = kandidatList.find((item) => item.id === deleteBtn.dataset.id);
    if (k) openDelete(k, deleteBtn);
  }
});

// ---------------------------------------------------------
// Form tambah / edit
// ---------------------------------------------------------
function openForm(kandidat, triggerEl) {
  editingKandidat = kandidat || null;
  lastFocusedEl = triggerEl || openBtn;

  formEl.reset();
  fotoInput.value = "";
  selectedFile = null;
  removeExistingFoto = false;
  hideFormError();

  if (editingKandidat) {
    formTitleEl.textContent = "Edit Kandidat";
    submitBtn.textContent = "Simpan Perubahan";
    document.getElementById("f-nomor").value = editingKandidat.nomor_paslon;
    document.getElementById("f-ketua").value = editingKandidat.nama_ketua;
    document.getElementById("f-wakil").value = editingKandidat.nama_wakil;
    document.getElementById("f-visi").value = editingKandidat.visi;
    document.getElementById("f-misi").value = editingKandidat.misi;
    document.getElementById("f-catatan").value = editingKandidat.catatan_tambahan || "";
  } else {
    formTitleEl.textContent = "Tambah Kandidat";
    submitBtn.textContent = "Simpan Kandidat";
    // Saran nomor paslon berikutnya
    const maxNomor = kandidatList.reduce((max, k) => Math.max(max, k.nomor_paslon), 0);
    document.getElementById("f-nomor").value = maxNomor + 1;
  }

  refreshFotoPreview();
  overlayEl.classList.remove("hidden");
  document.getElementById("f-ketua").focus();
}

function closeForm() {
  if (isSaving) return;
  overlayEl.classList.add("hidden");
  releasePreviewUrl();
  if (lastFocusedEl) lastFocusedEl.focus();
}

openBtn.addEventListener("click", () => openForm(null, openBtn));
cancelBtn.addEventListener("click", closeForm);
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) closeForm();
});

// --- Foto: pilih, validasi, pratinjau, hapus ---
fotoInput.addEventListener("change", () => {
  hideFormError();
  const file = fotoInput.files[0];

  if (!file) {
    selectedFile = null;
    refreshFotoPreview();
    return;
  }
  if (!FOTO_TYPES[file.type]) {
    rejectFoto("Format foto harus JPG, PNG, atau WEBP.");
    return;
  }
  if (file.size > MAX_FOTO_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    rejectFoto(`Ukuran foto maksimal 2 MB (foto ini ${mb} MB).`);
    return;
  }

  selectedFile = file;
  removeExistingFoto = false;
  refreshFotoPreview();
});

function rejectFoto(message) {
  fotoInput.value = "";
  selectedFile = null;
  showFormError(message);
  refreshFotoPreview();
}

fotoRemoveBtn.addEventListener("click", () => {
  fotoInput.value = "";
  selectedFile = null;
  removeExistingFoto = true;
  refreshFotoPreview();
});

function releasePreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

// Menampilkan foto baru (jika dipilih), foto lama (saat edit), atau placeholder
function refreshFotoPreview() {
  releasePreviewUrl();

  let src = null;
  if (selectedFile) {
    previewObjectUrl = URL.createObjectURL(selectedFile);
    src = previewObjectUrl;
  } else if (editingKandidat && editingKandidat.foto_path && !removeExistingFoto) {
    src = fotoUrl(editingKandidat.foto_path);
  }

  fotoPreviewEl.innerHTML = "";
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Pratinjau foto paslon";
    fotoPreviewEl.appendChild(img);
  } else {
    fotoPreviewEl.innerHTML = "<span>Belum ada foto</span>";
  }
  fotoRemoveBtn.classList.toggle("hidden", !src);
}

// --- Simpan ---
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isSaving) return;
  hideFormError();

  const nomor = parseInt(document.getElementById("f-nomor").value, 10);
  const payload = {
    nomor_paslon: nomor,
    nama_ketua: document.getElementById("f-ketua").value.trim(),
    nama_wakil: document.getElementById("f-wakil").value.trim(),
    visi: document.getElementById("f-visi").value.trim(),
    misi: document.getElementById("f-misi").value.trim(),
    catatan_tambahan: document.getElementById("f-catatan").value.trim() || null,
  };

  if (!Number.isInteger(nomor) || nomor < 1) {
    return showFormError("Nomor paslon harus berupa angka bulat minimal 1.");
  }
  if (!payload.nama_ketua || !payload.nama_wakil || !payload.visi || !payload.misi) {
    return showFormError("Nama ketua, nama wakil, visi, dan misi wajib diisi.");
  }

  const isEdit = editingKandidat !== null;
  const oldPath = isEdit ? editingKandidat.foto_path : null;
  let uploadedPath = null;

  isSaving = true;
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  submitBtn.textContent = "Menyimpan...";

  try {
    // 1) Upload foto baru (jika ada)
    if (selectedFile) {
      const path = `paslon/${uniqueId()}.${FOTO_TYPES[selectedFile.type]}`;
      const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, selectedFile, {
        contentType: selectedFile.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw new Error(`Foto gagal diunggah: ${uploadError.message}`);
      uploadedPath = path;
      payload.foto_path = path;
    } else if (isEdit) {
      payload.foto_path = removeExistingFoto ? null : oldPath; // tanpa perubahan jika tidak disentuh
    } else {
      payload.foto_path = null;
    }

    // 2) Simpan data. .select() dipakai untuk memastikan baris benar-benar tersimpan
    //    (jika izin database menolak, Supabase tidak melempar error, hanya 0 baris).
    const query = isEdit
      ? sb.from("tb_kandidat").update(payload).eq("id", editingKandidat.id).select()
      : sb.from("tb_kandidat").insert(payload).select();
    const { data, error } = await query;

    if (error) {
      // 23505 = unique_violation (nomor paslon sudah dipakai)
      throw new Error(
        error.code === "23505" ? `Nomor paslon ${nomor} sudah dipakai kandidat lain.` : error.message
      );
    }
    if (!data || data.length === 0) {
      throw new Error("Perubahan tidak tersimpan. Pastikan Anda login sebagai admin.");
    }

    // 3) Berhasil: bersihkan foto lama yang sudah tidak dipakai
    if (oldPath && oldPath !== payload.foto_path) await removeFotoFile(oldPath);

    isSaving = false;
    closeForm();
    showToast(
      "success",
      isEdit
        ? `Kandidat nomor ${nomor} berhasil diperbarui.`
        : `Kandidat nomor ${nomor} berhasil ditambahkan.`
    );
    await loadKandidat();
  } catch (err) {
    // Gagal setelah foto terlanjur terunggah: hapus agar tidak jadi file yatim
    if (uploadedPath) await removeFotoFile(uploadedPath);
    showFormError(err.message);
  } finally {
    isSaving = false;
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    submitBtn.textContent = isEdit ? "Simpan Perubahan" : "Simpan Kandidat";
  }
});

// ---------------------------------------------------------
// Hapus kandidat
// ---------------------------------------------------------
function openDelete(kandidat, triggerEl) {
  deleteTarget = kandidat;
  lastFocusedEl = triggerEl;

  deleteTextEl.textContent =
    `Kandidat nomor ${kandidat.nomor_paslon} (${kandidat.nama_ketua} & ${kandidat.nama_wakil}) ` +
    `akan dihapus permanen beserta fotonya. Tindakan ini tidak dapat dibatalkan.`;
  deleteErrorEl.className = "status-msg error hidden";
  deleteConfirmBtn.disabled = false;
  deleteCancelBtn.disabled = false;
  deleteConfirmBtn.textContent = "Ya, Hapus";

  deleteOverlayEl.classList.remove("hidden");
  deleteCancelBtn.focus(); // fokus awal di aksi yang aman
}

function closeDelete() {
  if (isDeleting) return;
  deleteOverlayEl.classList.add("hidden");
  deleteTarget = null;
  if (lastFocusedEl) lastFocusedEl.focus();
}

deleteCancelBtn.addEventListener("click", closeDelete);
deleteOverlayEl.addEventListener("click", (e) => {
  if (e.target === deleteOverlayEl) closeDelete();
});

deleteConfirmBtn.addEventListener("click", async () => {
  if (isDeleting || !deleteTarget) return;
  const target = deleteTarget;

  isDeleting = true;
  deleteConfirmBtn.disabled = true;
  deleteCancelBtn.disabled = true;
  deleteConfirmBtn.textContent = "Menghapus...";
  deleteErrorEl.className = "status-msg error hidden";

  const { data, error } = await sb.from("tb_kandidat").delete().eq("id", target.id).select();

  isDeleting = false;
  deleteCancelBtn.disabled = false;

  if (error || !data || data.length === 0) {
    let message = "Kandidat tidak terhapus. Pastikan Anda login sebagai admin.";
    if (error) {
      // 23503 = foreign_key_violation (kandidat sudah punya suara di tb_suara)
      message =
        error.code === "23503"
          ? "Kandidat ini sudah menerima suara sehingga tidak dapat dihapus."
          : error.message;
    }
    deleteErrorEl.textContent = message;
    deleteErrorEl.className = "status-msg error";
    deleteConfirmBtn.disabled = false;
    deleteConfirmBtn.textContent = "Ya, Hapus";
    return;
  }

  if (target.foto_path) await removeFotoFile(target.foto_path);

  closeDelete();
  showToast("success", `Kandidat nomor ${target.nomor_paslon} berhasil dihapus.`);
  await loadKandidat();
});

// Esc menutup popup yang sedang terbuka (popup hapus lebih dulu)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!deleteOverlayEl.classList.contains("hidden")) closeDelete();
  else if (!overlayEl.classList.contains("hidden")) closeForm();
});

// ---------------------------------------------------------
// Helper
// ---------------------------------------------------------
// Menghapus file foto di Storage. Kegagalan tidak menggagalkan proses utama
// (paling buruk tersisa file yatim), jadi hanya dicatat di console.
async function removeFotoFile(path) {
  try {
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) console.warn("Gagal menghapus file foto:", error.message);
  } catch (err) {
    console.warn("Gagal menghapus file foto:", err);
  }
}

function uniqueId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function showFormError(message) {
  formErrorEl.textContent = message;
  formErrorEl.className = "status-msg error";
}

function hideFormError() {
  formErrorEl.className = "status-msg error hidden";
}

function personIcon() {
  return `<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c0-4 3.4-6.4 7.5-6.4s7.5 2.4 7.5 6.4" stroke-linecap="round" />
  </svg>`;
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

(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) loadKandidat();
});