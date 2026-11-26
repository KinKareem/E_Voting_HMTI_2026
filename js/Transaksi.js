/* =========================================================
   Transaksi.js
   Logic untuk admin/transaksi.html — memantau saldo dan riwayat
   transaksi dua wallet di jaringan Sepolia:
     - Admin   : pemilik kontrak (wallet MetaMask yang membuka & menutup sesi)
     - Relayer : wallet yang mengirim suara ke blockchain (membayar gas)

   Alamat keduanya dibaca dari kontrak (owner() dan relayer()).
   Saldo dibaca lewat RPC; riwayat dibaca lewat API Blockscout
   (BLOCKCHAIN.HISTORY_API_URL di Blockchainconfig.js).
   ========================================================= */

const els = {
  subtitle: document.getElementById("trx-subtitle"),
  status: document.getElementById("trx-status"),
  wallets: document.getElementById("trx-wallets"),
  content: document.getElementById("trx-content"),
  more: document.getElementById("trx-more"),
  refresh: document.getElementById("trx-refresh"),
  filter: document.getElementById("trx-filter"),
};

// Wallet yang dipantau. address diisi setelah kontrak dibaca.
const wallets = {
  admin: { key: "admin", name: "Admin", note: "Membuka & menutup sesi", address: "", balance: null, balanceError: false },
  relayer: { key: "relayer", name: "Relayer", note: "Mengirim suara ke blockchain", address: "", balance: null, balanceError: false },
};

// Riwayat per alamat (huruf kecil): { items, next, error }
const history = {};
let currentFilter = "semua";
let contractAddress = "";
let runningRelayer = ""; // wallet relayer yang benar-benar berjalan (tb_status_relayer)
let loading = false;

// ---------------------------------------------------------
// Bantuan tampilan
// ---------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showStatus(type, message) {
  els.status.textContent = message;
  els.status.className = `status-msg ${type === "info" ? "" : type}`.trim();
}

function hideStatus() {
  els.status.className = "status-msg hidden";
}

function same(a, b) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

// Wei (string/bigint) -> teks ETH, dipotong tanpa pembulatan. 1500000000000000 -> "0.0015"
function formatEth(wei, digits = 6) {
  if (wei === null || wei === undefined) return "-";
  const text = ethers.formatEther(BigInt(wei));
  const [whole, frac = ""] = text.split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function explorerLink(path, label, title) {
  const base = (BLOCKCHAIN.EXPLORER_URL || "").replace(/\/$/, "");
  if (!base) return escapeHtml(label);
  return `<a href="${escapeHtml(base)}/${path}" target="_blank" rel="noopener" title="${escapeHtml(title || "")}">${escapeHtml(label)}</a>`;
}

// Nama yang mudah dipahami untuk sebuah alamat
function nameOf(address) {
  if (!address) return "Pembuatan kontrak";
  if (same(address, wallets.admin.address)) return "Admin";
  if (same(address, wallets.relayer.address)) return "Relayer";
  if (same(address, contractAddress)) return "Kontrak voting";
  return shortAddress(address);
}

function addressCell(address) {
  if (!address) return "Pembuatan kontrak";
  const known = nameOf(address);
  const label = known === shortAddress(address) ? known : `${known}`;
  return explorerLink(`address/${address}`, label, address);
}

const ACTION_LABELS = {
  castVotes: "Kirim suara (batch)",
  openSession: "Buka sesi voting",
  closeSession: "Tutup sesi voting",
  setRelayer: "Ganti relayer",
};

function actionLabel(tx) {
  if (tx.method && ACTION_LABELS[tx.method]) return ACTION_LABELS[tx.method];
  if (tx.method) return tx.method;
  return BigInt(tx.value || "0") > 0n ? "Transfer ETH" : "Transaksi";
}

// ---------------------------------------------------------
// Memuat data
// ---------------------------------------------------------
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server riwayat mengembalikan error ${res.status}.`);
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server riwayat tidak merespons (timeout).");
    if (e instanceof TypeError) throw new Error("Tidak dapat menghubungi server riwayat. Periksa koneksi internet.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function loadBalance(w) {
  try {
    w.balance = await getReadProvider().getBalance(w.address);
    w.balanceError = false;
  } catch (e) {
    w.balance = null;
    w.balanceError = true;
  }
}

async function loadHistoryPage(address, reset) {
  const key = address.toLowerCase();
  if (reset || !history[key]) history[key] = { items: [], next: null, error: null };
  const h = history[key];
  try {
    const base = BLOCKCHAIN.HISTORY_API_URL.replace(/\/$/, "");
    const qs = !reset && h.next ? "?" + new URLSearchParams(h.next).toString() : "";
    const data = await getJSON(`${base}/addresses/${address}/transactions${qs}`);
    h.items.push(...(data.items || []));
    h.next = data.next_page_params || null;
    h.error = null;
  } catch (e) {
    h.error = e.message;
  }
}

async function loadAll() {
  if (loading) return;
  loading = true;
  els.refresh.disabled = true;
  els.subtitle.textContent = "Memuat data blockchain...";
  hideStatus();

  try {
    await muatAlamatKontrak();
    const problem = blockchainConfigProblem();
    if (problem) {
      showStatus("error", problem);
      els.subtitle.textContent = "Kontrak belum siap.";
      els.content.innerHTML = `<div class="empty-msg">Riwayat tidak dapat ditampilkan.</div>`;
      return;
    }
    if (!BLOCKCHAIN.HISTORY_API_URL) {
      showStatus("error", "HISTORY_API_URL belum diisi di js/Blockchainconfig.js.");
      return;
    }
    contractAddress = BLOCKCHAIN.CONTRACT_ADDRESS;

    // Alamat admin (owner) dan relayer terdaftar, langsung dari kontrak
    let state;
    try {
      state = await readSessionState(getSessionContract());
    } catch (e) {
      showStatus("error", describeChainError(e).message);
      els.subtitle.textContent = "Gagal membaca kontrak.";
      return;
    }
    wallets.admin.address = state.owner;
    wallets.relayer.address = state.relayer;

    // Wallet relayer yang sedang berjalan, untuk mendeteksi ketidakcocokan
    runningRelayer = "";
    try {
      const { data } = await sb.from("tb_status_relayer").select("alamat_relayer").eq("id", 1).maybeSingle();
      if (data && data.alamat_relayer) runningRelayer = data.alamat_relayer;
    } catch (e) {
      /* tidak fatal */
    }

    const addresses = [...new Set([wallets.admin.address, wallets.relayer.address].map((a) => a.toLowerCase()))];
    await Promise.all([
      loadBalance(wallets.admin),
      loadBalance(wallets.relayer),
      ...addresses.map((a) => loadHistoryPage(a, true)),
    ]);

    renderAll();
    const now = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Makassar" });
    els.subtitle.textContent = `Jaringan ${BLOCKCHAIN.CHAIN_NAME}. Diperbarui ${now.replace(":", ".")} WITA.`;
  } finally {
    loading = false;
    els.refresh.disabled = false;
  }
}

async function loadMore() {
  els.more.disabled = true;
  els.more.textContent = "Memuat...";
  const targets = selectedAddresses().filter((a) => history[a.toLowerCase()] && history[a.toLowerCase()].next);
  await Promise.all(targets.map((a) => loadHistoryPage(a, false)));
  els.more.disabled = false;
  els.more.textContent = "Muat transaksi lebih lama";
  renderTable();
}

// ---------------------------------------------------------
// Tampilan
// ---------------------------------------------------------
function selectedAddresses() {
  if (currentFilter === "admin") return [wallets.admin.address];
  if (currentFilter === "relayer") return [wallets.relayer.address];
  return [...new Set([wallets.admin.address, wallets.relayer.address].map((a) => a.toLowerCase()))];
}

// Perkiraan berapa kali kirim batch lagi dari saldo relayer, berdasarkan rata-rata biaya castVotes terakhir
function estimateBatches(w) {
  if (w.key !== "relayer" || w.balance === null) return null;
  const h = history[w.address.toLowerCase()];
  if (!h) return null;
  const fees = h.items
    .filter((t) => t.method === "castVotes" && t.status === "ok" && same(t.from && t.from.hash, w.address) && t.fee && t.fee.value)
    .slice(0, 10)
    .map((t) => BigInt(t.fee.value));
  if (fees.length === 0) return null;
  const avg = fees.reduce((a, b) => a + b, 0n) / BigInt(fees.length);
  if (avg === 0n) return null;
  return { avg, count: Number(w.balance / avg) };
}

function balanceLevel(w) {
  if (w.balance === null) return { cls: "unknown", text: "Tidak diketahui" };
  if (w.balance === 0n) return { cls: "bad", text: "Habis" };
  const limit = ethers.parseEther(String((BLOCKCHAIN.LOW_BALANCE_ETH || {})[w.key] ?? 0.01));
  if (w.balance < limit) return { cls: "warn", text: "Menipis" };
  return { cls: "ok", text: "Aman" };
}

function renderWallets() {
  els.wallets.innerHTML = Object.values(wallets)
    .map((w) => {
      const lvl = balanceLevel(w);
      const est = estimateBatches(w);
      const saldo = w.balance === null ? "Gagal dibaca" : `${formatEth(w.balance, 6)} SepoliaETH`;
      const estimasi = est
        ? `<p class="trx-wallet-note">Cukup untuk sekitar <strong>${est.count}</strong> kali kirim batch (rata-rata ${formatEth(est.avg, 6)} ETH per batch, dari ${"10"} batch terakhir).</p>`
        : "";
      let warning = "";
      if (w.key === "relayer" && runningRelayer && !same(runningRelayer, w.address)) {
        warning = `<p class="trx-wallet-warn">Wallet relayer yang berjalan (${escapeHtml(shortAddress(runningRelayer))}) berbeda dengan yang terdaftar di kontrak. Saldo di atas milik yang terdaftar.</p>`;
      }
      return `
        <article class="trx-wallet ${lvl.cls}">
          <div class="trx-wallet-head">
            <div>
              <h2 class="trx-wallet-name">${escapeHtml(w.name)}</h2>
              <p class="trx-wallet-sub">${escapeHtml(w.note)}</p>
            </div>
            <span class="trx-badge ${lvl.cls}">${lvl.text}</span>
          </div>
          <p class="trx-wallet-balance">${escapeHtml(saldo)}</p>
          <p class="trx-wallet-addr">${explorerLink(`address/${w.address}`, w.address, "Lihat di explorer")}</p>
          ${estimasi}
          ${warning}
        </article>`;
    })
    .join("");
}

function mergedItems() {
  const wanted = new Set(selectedAddresses().map((a) => a.toLowerCase()));
  const byHash = new Map();
  wanted.forEach((a) => {
    const h = history[a];
    if (h) h.items.forEach((t) => byHash.set(t.hash, t));
  });
  return [...byHash.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function walletBadges(tx) {
  const from = tx.from && tx.from.hash;
  const to = tx.to && tx.to.hash;
  const tags = [];
  if (same(from, wallets.admin.address) || same(to, wallets.admin.address)) tags.push("Admin");
  if (same(from, wallets.relayer.address) || same(to, wallets.relayer.address)) tags.push("Relayer");
  return tags.map((t) => `<span class="trx-badge ${t === "Admin" ? "admin" : "relayer"}">${t}</span>`).join(" ");
}

function renderTable() {
  const items = mergedItems();
  const addrs = selectedAddresses();
  const errors = [...new Set(addrs.map((a) => history[a.toLowerCase()] && history[a.toLowerCase()].error).filter(Boolean))];
  if (errors.length) showStatus("error", `Riwayat gagal dimuat: ${errors[0]}`);
  else if (!loading) hideStatus();

  const canMore = addrs.some((a) => history[a.toLowerCase()] && history[a.toLowerCase()].next);
  els.more.classList.toggle("hidden", !canMore);

  if (items.length === 0) {
    els.content.innerHTML = `<div class="empty-msg">${errors.length ? "Riwayat tidak dapat ditampilkan." : "Belum ada transaksi."}</div>`;
    return;
  }

  const monitored = [wallets.admin.address, wallets.relayer.address];
  const rows = items
    .map((tx) => {
      const from = tx.from && tx.from.hash;
      const to = tx.to && tx.to.hash;
      const ok = tx.status === "ok";
      const paidByUs = monitored.some((a) => same(a, from));
      const fee = paidByUs && tx.fee ? `${formatEth(tx.fee.value, 8)}` : "-";
      const time = tx.timestamp ? formatChainTime(Date.parse(tx.timestamp) / 1000) : "-";
      return `
      <tr>
        <td>${escapeHtml(time)}</td>
        <td>${walletBadges(tx)}</td>
        <td class="strong">${escapeHtml(actionLabel(tx))}</td>
        <td>${addressCell(from)}</td>
        <td>${addressCell(to)}</td>
        <td class="trx-num">${escapeHtml(formatEth(tx.value || "0", 6))}</td>
        <td class="trx-num">${escapeHtml(fee)}</td>
        <td><span class="trx-badge ${ok ? "ok" : "bad"}">${ok ? "Berhasil" : tx.status === "error" ? "Gagal" : "Menunggu"}</span></td>
        <td>${explorerLink(`tx/${tx.hash}`, shortAddress(tx.hash), tx.hash)}</td>
      </tr>`;
    })
    .join("");

  els.content.innerHTML = `
    <table class="data-table trx-table">
      <thead>
        <tr>
          <th>Waktu</th>
          <th>Wallet</th>
          <th>Aksi</th>
          <th>Dari</th>
          <th>Ke</th>
          <th>Jumlah (ETH)</th>
          <th>Biaya gas (ETH)</th>
          <th>Status</th>
          <th>Transaksi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAll() {
  renderWallets();
  renderTable();
}

// ---------------------------------------------------------
// Event
// ---------------------------------------------------------
els.filter.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-pill");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  els.filter.querySelectorAll(".filter-pill").forEach((p) => p.classList.toggle("active", p === btn));
  if (wallets.admin.address) renderTable();
});

els.more.addEventListener("click", loadMore);
els.refresh.addEventListener("click", loadAll);

(window.adminReady || Promise.resolve(true)).then((ok) => {
  if (ok) loadAll();
});
