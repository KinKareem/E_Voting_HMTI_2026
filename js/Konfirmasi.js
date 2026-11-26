/* =========================================================
   Konfirmasi.js
   Logic untuk admin/konfirmasi.html — menyetujui/menolak
   ========================================================= */

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
  text.textContent = message;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Tutup notifikasi");
  close.textContent = "\u00d7";

  toast.append(icon, text, close);
  box.appendChild(toast);
  while (box.children.length > 4) box.firstElementChild.remove();


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
    .not("email", "is", null) // abaikan baris yang belum punya akun (belum mendaftar)
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
          ${p.ktm_path
          ? `<button class="btn-link" data-ktm="${escapeHtml(p.ktm_path)}">Lihat KTM</button>`
          : `<span class="muted">Belum ada</span>`
        }
        </td>
        <td>
          <div class="action-group">
            <button class="btn-approve" data-action="approved" data-id="${p.id}">Setujui</button>
            <button class="btn-reject" data-action="rejected" data-id="${p.id}" data-nama="${escapeHtml(p.nama_lengkap)} (${escapeHtml(p.nim)})">Tolak</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");

  contentEl.className = "";
  contentEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>NIM</th>
          <th>Nama Lengkap</th>
          <th>Email</th>
          <th>Terdaftar</th>
          <th>KTM</th>
          <th style="text-align:right">Aksi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "rejected") {
        const nama = btn.dataset.nama || "mahasiswa ini";
        const yakin = window.confirm(
          `Tolak pendaftaran ${nama}?\n\nAkun, status pendaftaran, dan file KTM yang sudah diunggah akan DIHAPUS PERMANEN. Mahasiswa ini bisa mendaftar ulang dari awal.`
        );
        if (!yakin) return;
      }
      handleDecision(btn.dataset.id, btn.dataset.action);
    });
  });

  // Bucket "ktm-mahasiswa" privat, jadi link langsung tidak bisa dibuka begitu saja.
  // Perlu signed URL sementara (berlaku 60 detik) yang dibuat saat tombol diklik.
  document.querySelectorAll("[data-ktm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const path = btn.dataset.ktm;
      const { data, error } = await sb.storage.from("ktm-mahasiswa").createSignedUrl(path, 60);
      btn.disabled = false;
      if (error || !data) {
        showToast("error", "Gagal membuka file KTM: " + (error ? error.message : "tidak diketahui"));
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    });
  });
}

async function handleDecision(id, decision) {
  const target = pendingList.find((p) => p.id === id);
  const buttons = document.querySelectorAll(`[data-id="${id}"]`);
  buttons.forEach((b) => (b.disabled = true));

  // Ditolak: hapus akun + file KTM sepenuhnya (lihat fn_admin_tolak_pendaftaran),
  // bukan cuma ubah status, supaya mahasiswa yang ditolak benar-benar bisa
  // mendaftar ulang dari nol dengan NIM yang sama.
  if (decision === "rejected") {
    const { error } = await sb.rpc("fn_admin_tolak_pendaftaran", { p_user_id: id });

    if (error) {
      showToast("error", `Gagal menolak pendaftaran: ${error.message}`);
      buttons.forEach((b) => (b.disabled = false));
      return;
    }

    // Akun sudah terhapus. Sekarang hapus file KTM lewat Storage API (Supabase melarang
    // `delete from storage.objects` langsung di SQL, jadi tidak bisa dilakukan di dalam fungsi database).
    // Policy "ktm_mahasiswa: hapus folder sendiri atau admin" mengizinkan admin menghapusnya.
    let ktmGagalDihapus = false;
    if (target && target.ktm_path) {
      const { error: errFile } = await sb.storage.from("ktm-mahasiswa").remove([target.ktm_path]);
      if (errFile) ktmGagalDihapus = true;
    }

    pendingList = pendingList.filter((p) => p.id !== id);
    renderTable();

    const who = target ? `${target.nama_lengkap} (${target.nim})` : "Mahasiswa";
    if (ktmGagalDihapus) {
      showToast("info", `Pendaftaran ${who} ditolak dan akunnya dihapus, tetapi file KTM gagal dihapus. Hapus manual lewat Supabase Storage.`);
    } else {
      showToast("success", `Pendaftaran ${who} ditolak dan datanya dihapus.`);
    }
    return;
  }

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


  pendingList = pendingList.filter((p) => p.id !== id);
  renderTable();

  const who = target ? `${target.nama_lengkap} (${target.nim})` : "Mahasiswa";
  showToast("success", `Pendaftaran ${who} disetujui.`);
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