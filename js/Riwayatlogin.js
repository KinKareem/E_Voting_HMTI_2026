/* =========================================================
   Riwayatlogin.js
   Logic untuk riwayat-login.html — login alternatif: cari NIM/nama,
   pilih akun, lalu masuk dengan password lewat Auth.loginByNim
   (jalur login yang sama dengan index.html).

   Pencarian memakai fungsi database fn_cari_pemilih (lihat
   supabase/fn_cari_pemilih.sql): minimal 3 karakter, maksimal 10
   hasil, nama disamarkan.
   ========================================================= */

const cariEl = document.getElementById("akun-cari");
const listEl = document.getElementById("akun-list");
const formEl = document.getElementById("akun-form");
const pwFieldEl = document.getElementById("akun-password-field");
const pwEl = document.getElementById("akun-password");
const terpilihEl = document.getElementById("akun-terpilih");
const masukBtn = document.getElementById("akun-masuk");
const statusEl = document.getElementById("akun-status");

const MIN_KARAKTER = 3;
let hasil = [];
let terpilih = null; // { nim, nama }
let timer = null;
let urutan = 0; // penanda agar hasil pencarian lama tidak menimpa yang baru

function showStatus(type, message) {
  statusEl.textContent = message;
  statusEl.className = `status-msg ${type}`;
}

function hideStatus() {
  statusEl.className = "status-msg hidden";
}

function tampilkanPesan(teks) {
  listEl.replaceChildren();
  const li = document.createElement("li");
  li.className = "akun-kosong";
  li.textContent = teks;
  listEl.append(li);
}

function buatBaris(a) {
  const li = document.createElement("li");
  li.className = "akun-row";

  const pilih = document.createElement("button");
  pilih.type = "button";
  pilih.className = "akun-item" + (terpilih && terpilih.nim === a.nim ? " active" : "");
  pilih.addEventListener("click", () => pilihAkun(a));

  const avatar = document.createElement("span");
  avatar.className = "akun-avatar";
  avatar.textContent = (a.nama || a.nim).trim().charAt(0).toUpperCase();

  const info = document.createElement("span");
  info.className = "akun-info";

  const nama = document.createElement("span");
  nama.className = "akun-nama";
  nama.style.display = "block";
  nama.textContent = a.nama || "-";

  const nim = document.createElement("span");
  nim.className = "akun-nim";
  nim.style.display = "block";
  nim.textContent = `NIM ${a.nim}`;

  info.append(nama, nim);
  pilih.append(avatar, info);
  li.append(pilih);
  return li;
}

function render() {
  if (hasil.length === 0) {
    tampilkanPesan("Tidak ditemukan. Pastikan Anda sudah mendaftar dan akun Anda sudah disetujui admin.");
    return;
  }
  listEl.replaceChildren(...hasil.map(buatBaris));
}

async function cari() {
  const q = cariEl.value.trim();

  if (q.length < MIN_KARAKTER) {
    urutan++;
    hasil = [];
    tampilkanPesan(`Ketik minimal ${MIN_KARAKTER} karakter NIM atau nama Anda.`);
    return;
  }

  const saya = ++urutan;
  tampilkanPesan("Mencari...");

  const { data, error } = await sb.rpc("fn_cari_pemilih", { p_kata: q });
  if (saya !== urutan) return;

  if (error) {
    tampilkanPesan(`Pencarian gagal: ${error.message}`);
    return;
  }

  hasil = data || [];
  render();
}

function pilihAkun(a) {
  terpilih = a;
  hideStatus();
  pwEl.value = "";
  terpilihEl.textContent = `${a.nama || a.nim} (${a.nim})`;
  pwFieldEl.className = "field";
  pwEl.required = true;
  masukBtn.disabled = false;
  render();
  pwEl.focus();
}

cariEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(cari, 300);
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!terpilih) return;
  hideStatus();

  masukBtn.disabled = true;
  masukBtn.textContent = "Memproses...";

  const result = await Auth.loginByNim({
    nim: terpilih.nim,
    password: pwEl.value,
    expectedRole: "mahasiswa",
  });

  masukBtn.disabled = false;
  masukBtn.textContent = "Masuk";

  if (!result.success) {
    showStatus("error", result.message);
    return;
  }

  showStatus("success", "Login berhasil, mengalihkan...");
  window.location.href = "landing.html";
});

tampilkanPesan(`Ketik minimal ${MIN_KARAKTER} karakter NIM atau nama Anda.`);