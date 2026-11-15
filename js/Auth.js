/* =========================================================
   Auth.js
   Fungsi-fungsi bersama untuk registrasi, login, dan reset
   password. Dipakai oleh Userpage.js, Adminpage.js, dan
   Forgotpassword.js. File ini butuh Supabaseclient.js sudah
   di-load lebih dulu (variabel global `sb`).
   ========================================================= */

const Auth = {

  // fileKtm: objek File dari <input type="file">, berisi scan KTM dalam format PDF (maks 200KB).
  async registerMahasiswa({ nim, namaLengkap, email, password, fileKtm }) {
    if (!fileKtm) {
      return { success: false, message: "Scan KTM (PDF) wajib diunggah." };
    }
    if (fileKtm.type !== "application/pdf") {
      return { success: false, message: "File KTM harus berformat PDF." };
    }
    const MAKS_UKURAN_KTM = 200 * 1024; // 200KB, harus sama dengan file_size_limit bucket di schema.sql
    if (fileKtm.size > MAKS_UKURAN_KTM) {
      return {
        success: false,
        message: "Ukuran file KTM maksimal 200KB. Silakan kompres PDF-nya terlebih dahulu.",
      };
    }

    const { data: signUpData, error: signUpError } = await sb.auth.signUp({
      email,
      password,
    });

    if (signUpError || !signUpData.user) {
      return {
        success: false,
        message: signUpError ? signUpError.message : "Registrasi gagal, silakan coba lagi.",
      };
    }

    // Upload KTM dulu (butuh sesi login, yang baru didapat dari signUp di atas), baru simpan
    // path-nya lewat fn_daftar_mahasiswa. Nama file diberi timestamp supaya upload ulang tidak bentrok.
    const pathKtm = `${signUpData.user.id}/ktm-${Date.now()}.pdf`;
    const { error: uploadError } = await sb.storage
      .from("ktm-mahasiswa")
      .upload(pathKtm, fileKtm, { contentType: "application/pdf" });

    if (uploadError) {
      await sb.auth.signOut();
      return {
        success: false,
        message: "Gagal mengunggah KTM: " + uploadError.message,
      };
    }

    // Mengaitkan akun login dengan baris mahasiswa di tb_pengguna yang sudah ada,
    // atau membuat baris baru bila NIM belum ada (lihat fn_daftar_mahasiswa).
    const { error: profileError } = await sb.rpc("fn_daftar_mahasiswa", {
      p_nim: nim,
      p_nama: namaLengkap,
      p_email: email,
      p_ktm_path: pathKtm,
    });

    if (profileError) {
      await sb.auth.signOut();
      return {
        success: false,
        message:
          isDuplicateError(profileError) || profileError.message.toLowerCase().includes("sudah terdaftar")
            ? "NIM ini sudah terdaftar sebelumnya."
            : profileError.message,
      };
    }

    await sb.auth.signOut();

    return {
      success: true,
      message:
        "Registrasi berhasil. Akun Anda menunggu konfirmasi dari admin sebelum dapat digunakan untuk login.",
    };
  },

  async loginByNim({ nim, password, expectedRole }) {
    const email = await getEmailByNim(nim);
    if (!email) {
      return { success: false, message: "NIM tidak ditemukan atau belum mendaftar akun." };
    }

    const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.user) {
      return { success: false, message: "NIM atau password salah." };
    }

    const { data: profile, error: profileError } = await sb
      .from("tb_pengguna")
      .select("*")
      .eq("id", signInData.user.id)
      .single();

    if (profileError || !profile) {
      await sb.auth.signOut();
      return { success: false, message: "Profil pengguna tidak ditemukan." };
    }

    if (profile.role !== expectedRole) {
      await sb.auth.signOut();
      return {
        success: false,
        message:
          expectedRole === "admin"
            ? "Akun ini bukan akun admin."
            : "Akun ini terdaftar sebagai admin, gunakan halaman login admin.",
      };
    }

    if (expectedRole === "mahasiswa") {
      if (profile.status === "pending") {
        await sb.auth.signOut();
        return { success: false, message: "Akun Anda masih menunggu konfirmasi admin." };
      }
      if (profile.status === "rejected") {
        await sb.auth.signOut();
        return {
          success: false,
          message: "Registrasi Anda ditolak admin. Silakan lakukan registrasi ulang.",
        };
      }
    }

    return { success: true, message: "Login berhasil.", profile };
  },

  async requestPasswordReset(nim) {
    const email = await getEmailByNim(nim);
    if (!email) {
      return { success: false, message: "NIM tidak ditemukan atau belum mendaftar akun." };
    }

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/forgot-password.html`,
    });

    if (error) {
      return { success: false, message: error.message };
    }

    return {
      success: true,
      message: "Tautan reset password telah dikirim ke email yang terdaftar untuk NIM ini.",
    };
  },
};

async function getEmailByNim(nim) {
  const { data, error } = await sb.rpc("get_email_by_nim", { input_nim: nim });
  if (error || !data) return null;
  return data;
}

function isDuplicateError(error) {
  const msg = error.message.toLowerCase();
  return msg.includes("duplicate") || msg.includes("unique");
}