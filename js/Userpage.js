/* =========================================================
   Userpage.js
   Logic untuk index.html — login & register mahasiswa,
   termasuk animasi sliding antara kedua form di dalam box
   yang sama.
   ========================================================= */

// --- Toggle tab Masuk/Daftar + animasi slide ---
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const authTrack = document.getElementById("auth-track");

function setAuthMode(mode) {
  const isRegister = mode === "register";
  authTrack.classList.toggle("show-register", isRegister);
  tabLogin.classList.toggle("active", !isRegister);
  tabRegister.classList.toggle("active", isRegister);
}

tabLogin.addEventListener("click", () => setAuthMode("login"));
tabRegister.addEventListener("click", () => setAuthMode("register"));

// --- Helper tampilkan pesan status (sukses/error) ---
function showStatus(elementId, type, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `status-msg ${type}`;
}

function hideStatus(elementId) {
  const el = document.getElementById(elementId);
  el.className = "status-msg hidden";
}

// --- Form LOGIN ---
const loginForm = document.getElementById("login-form");
const loginSubmit = document.getElementById("login-submit");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus("login-status");

  const nim = document.getElementById("login-nim").value.trim();
  const password = document.getElementById("login-password").value;

  loginSubmit.disabled = true;
  loginSubmit.textContent = "Memproses...";

  const result = await Auth.loginByNim({ nim, password, expectedRole: "mahasiswa" });

  loginSubmit.disabled = false;
  loginSubmit.textContent = "Masuk";

  if (!result.success) {
    showStatus("login-status", "error", result.message);
    return;
  }

  showStatus("login-status", "success", "Login berhasil, mengalihkan...");
  window.location.href = "landing.html";
});

// --- Form REGISTER ---
const registerForm = document.getElementById("register-form");
const registerSubmit = document.getElementById("register-submit");

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus("register-status");

  const nim = document.getElementById("reg-nim").value.trim();
  const namaLengkap = document.getElementById("reg-nama").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirmPassword = document.getElementById("reg-confirm-password").value;

  if (password !== confirmPassword) {
    showStatus("register-status", "error", "Konfirmasi password tidak cocok.");
    return;
  }
  if (password.length < 6) {
    showStatus("register-status", "error", "Password minimal 6 karakter.");
    return;
  }

  registerSubmit.disabled = true;
  registerSubmit.textContent = "Memproses...";

  const result = await Auth.registerMahasiswa({ nim, namaLengkap, email, password });

  registerSubmit.disabled = false;
  registerSubmit.textContent = "Daftar";

  showStatus("register-status", result.success ? "success" : "error", result.message);

  if (result.success) {
    registerForm.reset();
    setTimeout(() => setAuthMode("login"), 1500);
  }
});
