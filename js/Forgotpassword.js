/* =========================================================
   Forgotpassword.js
   Logic untuk forgot-password.html.
   ========================================================= */

const forgotForm = document.getElementById("forgot-form");
const forgotSubmit = document.getElementById("forgot-submit");
const forgotStatus = document.getElementById("forgot-status");

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  forgotStatus.className = "status-msg hidden";

  const nim = document.getElementById("forgot-nim").value.trim();

  forgotSubmit.disabled = true;
  forgotSubmit.textContent = "Memproses...";

  const result = await Auth.requestPasswordReset(nim);

  forgotSubmit.disabled = false;
  forgotSubmit.textContent = "Kirim Tautan Reset";

  forgotStatus.textContent = result.message;
  forgotStatus.className = `status-msg ${result.success ? "success" : "error"}`;
});
