// Small DOM toolkit: theme, toasts, modals, connection pill, install prompt.
import { $, $$, escapeHtml } from "./util.js";

const THEME_KEY = "sb-theme";

export function initTheme() {
  let t = localStorage.getItem(THEME_KEY);
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  const btn = $("#themeBtn");
  if (btn) btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    document.dispatchEvent(new CustomEvent("sb:theme", { detail: next }));
  });
}

export function toast(message, kind = "") {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts"; host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 250); }, 3600);
}

function modalHost() {
  let host = $("#modalRoot");
  if (!host) {
    host = document.createElement("div");
    host.id = "modalRoot";
    document.body.appendChild(host);
  }
  return host;
}

// Generic modal. `render` returns HTML; `wire(root, close)` binds behaviour.
export function openModal({ title, html, wire, onClose }) {
  const host = modalHost();
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h2>${escapeHtml(title || "")}</h2>
      <div class="modal-body">${html || ""}</div>
    </div>`;
  host.appendChild(scrim);
  const close = (val) => { scrim.remove(); onClose?.(val); };
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(null); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(null); }
  });
  wire?.(scrim.querySelector(".modal"), close);
  return close;
}

export function confirmDialog({ title, body, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    openModal({
      title,
      html: `<p>${escapeHtml(body || "")}</p>
        <div class="row" style="justify-content:flex-end;margin-top:1rem">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>`,
      wire(root, close) {
        root.querySelector('[data-act="cancel"]').onclick = () => close(false);
        root.querySelector('[data-act="ok"]').onclick = () => close(true);
      },
      onClose(v) { resolve(v === true); },
    });
  });
}

export function promptDialog({ title, label, value = "", placeholder = "", maxlength = 200, confirmText = "Save" }) {
  return new Promise((resolve) => {
    openModal({
      title,
      html: `<label>${escapeHtml(label || "")}</label>
        <input class="input" id="__pd" maxlength="${maxlength}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
        <div class="row" style="justify-content:flex-end;margin-top:1rem">
          <button class="btn" data-act="cancel">Cancel</button>
          <button class="btn primary" data-act="ok">${escapeHtml(confirmText)}</button>
        </div>`,
      wire(root, close) {
        const inp = root.querySelector("#__pd");
        inp.focus(); inp.select();
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") close(inp.value.trim()); });
        root.querySelector('[data-act="cancel"]').onclick = () => close(null);
        root.querySelector('[data-act="ok"]').onclick = () => close(inp.value.trim());
      },
      onClose(v) { resolve(typeof v === "string" ? v : null); },
    });
  });
}

export function setConn(state, text) {
  const dot = $("#connDot"), label = $("#connText");
  if (dot) dot.className = "dot " + state;
  if (label) label.textContent = text;
}

export function initOnlineBanner() {
  const banner = $("#netBanner");
  if (!banner) return;
  const update = () => {
    const online = navigator.onLine;
    banner.classList.toggle("hidden", online);
    if (!online) setConn("offline", "offline");
    else setConn("warn", "reconnecting…");
  };
  addEventListener("online", update);
  addEventListener("offline", update);
  update();
}

export function initInstallPrompt() {
  const btn = $("#installBtn");
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    if (btn) btn.hidden = false;
  });
  btn?.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") btn.hidden = true;
    deferred = null;
  });
}

// Registers the service worker that makes the app installable and gives it the
// offline shell. Without this the manifest alone does nothing. Failures are
// ignored: registration is refused on file:// and in some sandboxed contexts,
// and the app works fine without it.
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
