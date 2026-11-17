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
tabRegister.addEventListener("click", () => {
  setAuthMode("register");
  perbaruiStatusPendaftaran(); // status sesi bisa berubah sejak halaman dibuka
});

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

// --- Tombol mata: lihat / sembunyikan password ---
const IKON_MATA =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const IKON_MATA_CORET =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2"/><path d="M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function pasangTombolMata(input) {
  const wrap = document.createElement("div");
  wrap.className = "password-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toggle-password";
  wrap.appendChild(btn);

  const atur = (tampil) => {
    input.type = tampil ? "text" : "password";
    btn.innerHTML = tampil ? IKON_MATA_CORET : IKON_MATA;
    const label = tampil ? "Sembunyikan password" : "Tampilkan password";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", tampil ? "true" : "false");
    btn.title = label;
  };
  atur(false);

  btn.addEventListener("click", () => {
    atur(input.type === "password");
    input.focus();
  });
  // Setelah form di-reset (mis. selesai mendaftar), password kembali tersembunyi.
  if (input.form) input.form.addEventListener("reset", () => atur(false));
}

["login-password", "reg-password", "reg-confirm-password"].forEach((id) => {
  const input = document.getElementById(id);
  if (input) pasangTombolMata(input);
});

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
const registerClosed = document.getElementById("register-closed");

// Pendaftaran ditutup selama sesi voting berlangsung (mencegah pendaftaran ilegal).
// Form dikunci di sini; penegakan sebenarnya ada di database (fn_daftar_mahasiswa + trigger).
let pendaftaranDibuka = true;

async function perbaruiStatusPendaftaran() {
  const status = await Auth.cekPendaftaranDibuka();
  pendaftaranDibuka = status.dibuka === true;

  registerClosed.textContent = status.pesan;
  registerClosed.classList.toggle("hidden", pendaftaranDibuka);

  registerForm.querySelectorAll("input").forEach((input) => {
    input.disabled = !pendaftaranDibuka;
  });
  registerSubmit.disabled = !pendaftaranDibuka;
  registerSubmit.textContent = pendaftaranDibuka ? "Daftar" : "Pendaftaran Ditutup";
}

perbaruiStatusPendaftaran();

// Kolom NIM di form DAFTAR hanya menerima angka: karakter lain (huruf, spasi, tanda) dibuang saat diketik/ditempel.
// Sengaja tidak dipasang di form Masuk maupun halaman admin.
const regNimInput = document.getElementById("reg-nim");
regNimInput.addEventListener("input", () => {
  const bersih = regNimInput.value.replace(/[^0-9]/g, "");
  if (bersih !== regNimInput.value) regNimInput.value = bersih;
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideStatus("register-status");
  if (!pendaftaranDibuka) return;

  const nim = document.getElementById("reg-nim").value.trim();
  const namaLengkap = document.getElementById("reg-nama").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirmPassword = document.getElementById("reg-confirm-password").value;
  const fileKtm = document.getElementById("reg-ktm").files[0];

  if (!/^[0-9]+$/.test(nim)) {
    showStatus("register-status", "error", "NIM hanya boleh berisi angka (tanpa huruf, spasi, atau tanda baca).");
    return;
  }
  if (password !== confirmPassword) {
    showStatus("register-status", "error", "Konfirmasi password tidak cocok.");
    return;
  }
  if (password.length < 6) {
    showStatus("register-status", "error", "Password minimal 6 karakter.");
    return;
  }
  if (!fileKtm) {
    showStatus("register-status", "error", "Scan KTM (PDF) wajib diunggah.");
    return;
  }

  registerSubmit.disabled = true;
  registerSubmit.textContent = "Memproses...";

  let result;
  try {
    result = await Auth.registerMahasiswa({ nim, namaLengkap, email, password, fileKtm });
  } catch (err) {
    console.error("Registrasi gagal:", err);
    result = { success: false, message: "Terjadi kesalahan: " + (err?.message || err) };
  } finally {
    registerSubmit.disabled = false;
    registerSubmit.textContent = "Daftar";
  }

  showStatus("register-status", result.success ? "success" : "error", result.message);

  if (result.success) {
    registerForm.reset();
    setTimeout(() => setAuthMode("login"), 1500);
  } else {
    // Mungkin gagal karena sesi baru saja dimulai: sinkronkan tampilan form.
    await perbaruiStatusPendaftaran();
  }
});