
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = ""


const { createClient } = supabase;

const IS_ADMIN_AREA = /\/admin(\.html|\/)/.test(window.location.pathname);

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
   auth: { storageKey: IS_ADMIN_AREA ? "evoting-admin-auth" : "evoting-user-auth" },
});
