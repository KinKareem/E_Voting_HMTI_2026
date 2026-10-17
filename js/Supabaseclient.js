/* =========================================================
   Supabaseclient.js
   Inisialisasi koneksi ke Supabase.

   WAJIB DIISI: ganti dua nilai di bawah dengan kredensial
   project Supabase Anda sendiri (Dashboard > Settings > API).
   ========================================================= */

const SUPABASE_URL = "https://cjmxejabrqgqqwjadctt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqbXhlamFicnFncXF3amFkY3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxODQ4NzksImV4cCI6MjEwNTc2MDg3OX0.xnbNrte9GwOBcnbc4UG3XK0w6WFr_oefCHvc4D_2Nc8";

// `supabase` di sini adalah objek global yang disediakan oleh
// script CDN <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// yang harus di-load SEBELUM file ini di setiap halaman HTML.
const { createClient } = supabase;

// Sesi login admin dan mahasiswa disimpan di tempat TERPISAH (storageKey berbeda).
// Tanpa ini, keduanya berbagi satu sesi per browser: mendaftar/login sebagai
// mahasiswa di browser yang sama akan menimpa lalu menghapus sesi admin, dan
// halaman admin akan tampak kosong karena dibaca sebagai "belum login".
// Halaman admin = admin.html dan semua halaman di folder admin/.
const IS_ADMIN_AREA = /\/admin(\.html|\/)/.test(window.location.pathname);

// Dipakai oleh semua file JS lain lewat variabel global `sb`.
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
   auth: { storageKey: IS_ADMIN_AREA ? "evoting-admin-auth" : "evoting-user-auth" },
});
