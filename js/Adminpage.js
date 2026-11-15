/* =========================================================
   Adminpage.js
   Logic untuk admin.html — login admin. Pendaftaran admin sengaja tidak ada;
   akun admin ditambahkan manual lewat SQL (supabase/tambah_admin.sql).
   ========================================================= */

function showStatus(elementId, type, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

function hideStatus(elementId) {
  const el = document.getElementById(elementId);
  el.className = "status-msg hidden";
}
if (new URLSearchParams(window.location.search).get("sesi") === "habis") {
  showStatus(
    "login-status",
    "error",
    "Sesi admin tidak ditemukan atau sudah berakhir. Silakan login kembali."
  );
}

// --- Form LOGIN ADMIN ---
const loginForm = document.getElementById("login-form");
const loginSubmit = document.getElementById("login-submit");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus("login-status");

  const nim = document.getElementById("login-nim").value.trim();
  const password = document.getElementById("login-password").value;

  loginSubmit.disabled = true;
  loginSubmit.textContent = "Memproses...";

  const result = await Auth.loginByNim({ nim, password, expectedRole: "admin" });

  loginSubmit.disabled = false;
  loginSubmit.textContent = "Masuk";

  if (!result.success) {
    showStatus("login-status", "error", result.message);
    return;
  }

  showStatus("login-status", "success", "Login berhasil, mengalihkan...");
  window.location.href = "admin/konfirmasi.html";
});