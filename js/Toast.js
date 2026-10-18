

const TOAST_DURATION = { success: 4000, info: 4000, error: 6500 };
const TOAST_MAX_VISIBLE = 4;

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function toastIcon(type) {
  if (type === "success") {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`;
  }
  if (type === "error") {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4h.01" stroke-linecap="round" />
    </svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6h.01" stroke-linecap="round" />
  </svg>`;
}

function showToast(type, message) {
  const kind = ["success", "error", "info"].includes(type) ? type : "info";
  const container = getToastContainer();

  while (container.children.length >= TOAST_MAX_VISIBLE) {
    removeToast(container.firstElementChild, true);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;

  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  toast.innerHTML = `
    <span class="toast-icon">${toastIcon(kind)}</span>
    <p class="toast-message"></p>
    <button type="button" class="toast-close" aria-label="Tutup notifikasi">&times;</button>
  `;
  toast.querySelector(".toast-message").textContent = message;
  container.appendChild(toast);

  let timer = null;
  const start = () => {
    timer = setTimeout(() => removeToast(toast), TOAST_DURATION[kind]);
  };
  const stop = () => clearTimeout(timer);

  toast.addEventListener("mouseenter", stop);
  toast.addEventListener("mouseleave", start);
  toast.querySelector(".toast-close").addEventListener("click", () => {
    stop();
    removeToast(toast);
  });

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-show")));
  start();

  return toast;
}

function removeToast(toast, immediate = false) {
  if (!toast || !toast.parentNode) return;
  if (immediate) {
    toast.remove();
    return;
  }
  toast.classList.remove("toast-show");
  const done = () => toast.remove();
  toast.addEventListener("transitionend", done, { once: true });
  setTimeout(done, 500);
}
