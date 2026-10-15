// =============================================================================
// Home / dashboard: create a room, join with a code, list your rooms.
// =============================================================================
import { sb } from "./supabase-client.js";
import * as auth from "./auth.js";
import { $, escapeHtml, fmtClock, saveInviteCode } from "./util.js";
import {
  initTheme, initOnlineBanner, initInstallPrompt, registerServiceWorker,
  toast, setConn,
} from "./ui.js";
import { showAuthGate, authGateHandlers } from "./auth-ui.js";
import { MAX_ROOM_NAME_LEN, MAX_NICK_LEN, REPO_URL } from "./config.js";

initTheme();
initOnlineBanner();
initInstallPrompt();
registerServiceWorker();

const NICK_KEY = "sb-nickname";

// If someone lands on the home page with an invite link, forward to the room.
const params = new URLSearchParams(location.search);
if (params.get("invite")) {
  location.replace("room.html?" + params.toString());
}

function busy(btn, on) { if (btn) btn.disabled = on; }

// The signed-out home page: the site is visible, and sign-in / sign-up are
// ordinary links in the header and in the hero card.
function showSignedOut() {
  $("#signedOutCard")?.classList.remove("hidden");
  $("#createJoin")?.classList.add("hidden");
  $("#roomsSection")?.classList.add("hidden");
  $("#signInLink")?.classList.remove("hidden");
  $("#signUpLink")?.classList.remove("hidden");
  $("#signOutBtn")?.classList.add("hidden");
}

async function boot() {
  const urlState = auth.initialUrlState();
  let user = null;
  try {
    user = await auth.requireSession();
    setConn("online", "connected");
  } catch (e) {
    setConn("offline", "offline");
    toast(e.message, "error");
    $("#roomsNote").textContent = "Backend unavailable. Check js/config.js and that the Supabase project is running.";
    return;
  }

  // Arriving from a password-reset link: set a new password before anything else.
  if (urlState?.type === "recovery") {
    showAuthGate(authGateHandlers(auth, { recovery: true }));
    return;
  }

  // No session: show the site with real sign-in / sign-up entry points, rather
  // than hiding everything behind a modal. Nothing is ever created behind your
  // back — you choose to sign in.
  if (!user) {
    showSignedOut();
    if (urlState?.error) toast(urlState.error, "error");
    return;
  }
  auth.cleanUrl();
  $("#signedOutCard")?.classList.add("hidden");
  $("#signInLink")?.classList.add("hidden");
  $("#signUpLink")?.classList.add("hidden");

  const saved = localStorage.getItem(NICK_KEY) || auth.displayName(user);
  $("#createNick").value = saved;
  $("#joinNick").value = saved;

  // Show the source link only once a real repository URL is configured.
  const repoLink = $("#repoLink");
  if (repoLink && REPO_URL && !REPO_URL.includes("your-username")) {
    repoLink.href = REPO_URL;
    repoLink.hidden = false;
  }

  // With a real account there is no fragile browser-local identity to warn
  // about — say who you are signed in as and move on.
  const sessionLine = $("#sessionLine");
  if (sessionLine) {
    sessionLine.innerHTML = `Signed in as <strong>${escapeHtml(auth.userEmail(user) || auth.displayName(user))}</strong> — your rooms follow this account, on any device.`;
  }

  const signOutBtn = $("#signOutBtn");
  if (signOutBtn) {
    signOutBtn.hidden = false;
    signOutBtn.onclick = async () => { await auth.signOut(); location.reload(); };
  }

  $("#createBtn").onclick = onCreate;
  $("#joinBtn").onclick = onJoin;
  $("#refreshRooms").onclick = loadRooms;
  loadRooms();
}

function rememberNick(nick) { try { localStorage.setItem(NICK_KEY, nick); } catch {} }

async function onCreate() {
  const name = $("#createName").value.trim();
  const nick = $("#createNick").value.trim();
  const msg = $("#createMsg");
  msg.textContent = "";
  if (name.length < 1) { msg.textContent = "Give the room a name."; return; }
  if (nick.length < 1) { msg.textContent = "Pick a nickname."; return; }
  const btn = $("#createBtn");
  busy(btn, true);
  try {
    const { data, error } = await sb.rpc("create_room", { p_name: name.slice(0, MAX_ROOM_NAME_LEN), p_nickname: nick.slice(0, MAX_NICK_LEN) });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    rememberNick(nick);
    // Capture the plaintext code now: only its hash is stored server-side, so
    // this is the one moment it exists. `new=1` makes the room open its invite
    // dialog straight away so the link is not left hidden behind a button.
    saveInviteCode(row.room_id, row?.invite_code);
    location.href = "room.html?room=" + encodeURIComponent(row.room_id) + "&new=1";
  } catch (e) {
    msg.textContent = friendly(e);
  } finally { busy(btn, false); }
}

async function onJoin() {
  const code = $("#joinCode").value.trim().toUpperCase();
  const nick = $("#joinNick").value.trim();
  const msg = $("#joinMsg");
  msg.textContent = "";
  if (code.length < 6) { msg.textContent = "Enter the invitation code."; return; }
  if (nick.length < 1) { msg.textContent = "Pick a nickname."; return; }
  const btn = $("#joinBtn");
  busy(btn, true);
  try {
    const { data, error } = await sb.rpc("join_room", { p_code: code, p_nickname: nick.slice(0, MAX_NICK_LEN) });
    if (error) throw error;
    rememberNick(nick);
    location.href = "room.html?room=" + encodeURIComponent(data);
  } catch (e) {
    msg.textContent = friendly(e);
  } finally { busy(btn, false); }
}

function friendly(e) {
  const m = (e?.message || String(e)).toLowerCase();
  if (m.includes("invite code not found")) return "No room matches that code. Check for typos.";
  if (m.includes("revoked")) return "That invitation link was revoked by the owner.";
  if (m.includes("expired")) return "That invitation link has expired.";
  if (m.includes("locked")) return "This room is locked and is not accepting new members.";
  if (m.includes("rate limit")) return "Too many attempts — please wait a little and try again.";
  if (m.includes("invalid")) return "Please check the name and nickname.";
  return e?.message || "Something went wrong.";
}

async function loadRooms() {
  const host = $("#roomList");
  const note = $("#roomsNote");
  host.innerHTML = `<div class="skeleton" style="height:56px"></div>`;
  note.textContent = "";
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { host.innerHTML = ""; note.textContent = "Signing in…"; return; }
    const { data, error } = await sb
      .from("room_members")
      .select("role, nickname, joined_at, rooms(id, name, owner_id, last_active_at)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms = (data || []).filter(r => r.rooms);
    if (!rooms.length) {
      host.innerHTML = `<p class="muted small">No rooms yet. Create one above or join with a code.</p>`;
      return;
    }
    host.innerHTML = rooms.map(r => `
      <a class="room-item" href="room.html?room=${encodeURIComponent(r.rooms.id)}">
        <span class="avatar" style="background:${roleColor(r.rooms.id)}">${escapeHtml((r.rooms.name || "R")[0].toUpperCase())}</span>
        <span class="grow">
          <span class="name">${escapeHtml(r.rooms.name)}</span>
          <span class="muted small" style="display:block">
            ${r.role === "owner" ? "Owner" : "Member"} · as ${escapeHtml(r.nickname)} ·
            active ${r.rooms.last_active_at ? fmtClock(r.rooms.last_active_at) : "—"}
          </span>
        </span>
        <span class="btn sm">Open</span>
      </a>`).join("");
  } catch (e) {
    host.innerHTML = "";
    note.textContent = friendly(e);
  }
}

function roleColor(seed) {
  let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 72%)`;
}

boot();
