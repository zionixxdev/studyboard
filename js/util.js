// Pure helpers — no DOM, no network.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function randomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms = 50) {
  let last = 0, timer = null, lastArgs = null;
  return (...a) => {
    const now = Date.now();
    lastArgs = a;
    if (now - last >= ms) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { timer = null; last = Date.now(); fn(...lastArgs); }, ms - (now - last));
    }
  };
}

export function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function fmtClock(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

export function colorFor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 72%)`;
}

export function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || "?").join("");
}

export function sanitizeFilename(name) {
  return String(name || "file")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

// ---- invite codes -----------------------------------------------------------
// Only the SHA-256 hash of an invite code is stored on the server, so the
// plaintext exists solely in the share link. The owner's own browser keeps a
// copy here — localStorage rather than sessionStorage, so the link is still
// there after closing the tab. One helper, used by both pages, so the storage
// key can never drift apart again.
const INVITE_KEY = (roomId) => "sb-invite-" + roomId;

export function saveInviteCode(roomId, code) {
  if (!roomId || !code) return;
  try { localStorage.setItem(INVITE_KEY(roomId), String(code).toUpperCase()); } catch {}
}

export function loadInviteCode(roomId) {
  try { return localStorage.getItem(INVITE_KEY(roomId)); } catch { return null; }
}

export function inviteLink(code) {
  return new URL("room.html?invite=" + String(code).toUpperCase(), location.href).toString();
}

// Minimal, safe linkifier + inline LaTeX renderer for chat. Everything is
// escaped first; only http(s) links are turned into anchors.
export function renderMessageBody(text, renderMath) {
  const safe = escapeHtml(text);
  let html = safe.replace(/\bhttps?:\/\/[^\s<]+/g, (u) =>
    `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  if (renderMath) {
    html = html.replace(/\$([^$\n]{1,400})\$/g, (m, tex) => {
      try { return `<span class="math-inline" data-tex="${escapeHtml(tex)}"></span>`; }
      catch { return m; }
    });
  }
  return html;
}
