// =============================================================================
// Room workspace orchestrator.
// Owns the Realtime channel, the whiteboard, and every side panel, and wires
// the server-authoritative RPCs to the UI.
// =============================================================================
import { sb } from "./supabase-client.js";
import { ensureSession } from "./auth.js";
import {
  $, $$, escapeHtml, randomId, fmtTime, fmtClock, fmtBytes,
  colorFor, initials, throttle, renderMessageBody,
} from "./util.js";
import {
  initTheme, initOnlineBanner, initInstallPrompt, toast, setConn,
  openModal, confirmDialog, promptDialog,
} from "./ui.js";
import { Whiteboard, PALETTE } from "./whiteboard.js";
import { createChat } from "./chat.js";
import { createTimer } from "./timer.js";
import { createFiles } from "./files.js";
import { createCall } from "./webrtc.js";
import {
  openEquationEditor, openGraphEditor, openFormulaReference,
  renderMathIn, texToSvg,
} from "./math-tools.js";
import { MAX_NICK_LEN } from "./config.js";

initTheme();
initOnlineBanner();
initInstallPrompt();

const NICK_KEY = "sb-nickname";

let me = null;
let myMember = null;
let room = null;
let pages = [];
let members = [];
let currentPageId = null;
let channel = null;
let board = null;
let chat = null;
let timer = null;
let files = null;
let call = null;
let myColor = "#0ea5a4";
let heartbeat = null;

const params = new URLSearchParams(location.search);

main();

async function main() {
  try {
    me = await ensureSession();
  } catch (e) {
    toast(e.message, "error");
    return;
  }

  let roomId = params.get("room");
  const inviteCode = params.get("invite");

  if (!roomId && inviteCode) {
    roomId = await joinViaInvite(inviteCode);
    if (!roomId) { location.href = "index.html"; return; }
  }
  if (!roomId) { toast("No room specified.", "error"); location.href = "index.html"; return; }

  myMember = await getMyMembership(roomId);
  if (!myMember) {
    const ok = await joinExisting(roomId, inviteCode);
    if (!ok) { location.href = "index.html"; return; }
    myMember = await getMyMembership(roomId);
  }
  if (!myMember) { location.href = "index.html"; return; }

  myColor = colorFor(me);
  await startRoom(roomId);
}

// --------------------------------------------------------------- entry paths
async function joinViaInvite(code) {
  const nick = await askNickname();
  if (!nick) return null;
  try {
    const { data, error } = await sb.rpc("join_room", { p_code: code.toUpperCase(), p_nickname: nick });
    if (error) throw error;
    rememberCode(data, code);
    history.replaceState(null, "", "room.html?room=" + encodeURIComponent(data));
    return data;
  } catch (e) { toast(friendly(e), "error"); return null; }
}

async function joinExisting(roomId, code) {
  const c = code || await promptDialog({ title: "Join this room", label: "Invitation code", placeholder: "e.g. K7QM2XZ9PT", maxlength: 64 });
  if (!c) return false;
  const nick = await askNickname();
  if (!nick) return false;
  try {
    const { data, error } = await sb.rpc("join_room", { p_code: c.toUpperCase(), p_nickname: nick });
    if (error) throw error;
    rememberCode(roomId, c);
    return true;
  } catch (e) { toast(friendly(e), "error"); return false; }
}

async function askNickname() {
  const saved = localStorage.getItem(NICK_KEY) || "";
  const nick = await promptDialog({
    title: "Pick a nickname",
    label: "How should others see you?",
    value: saved, placeholder: "e.g. Aditya", maxlength: MAX_NICK_LEN, confirmText: "Continue",
  });
  if (!nick) return null;
  try { localStorage.setItem(NICK_KEY, nick); } catch {}
  return nick;
}

async function getMyMembership(roomId) {
  const { data, error } = await sb
    .from("room_members")
    .select("user_id, nickname, role, room_id")
    .eq("room_id", roomId)
    .eq("user_id", me)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

function rememberCode(roomId, code) {
  try { sessionStorage.setItem("sb-invite-" + roomId, code.toUpperCase()); } catch {}
}
function recallCode(roomId) {
  try { return sessionStorage.getItem("sb-invite-" + roomId); } catch { return null; }
}

// ------------------------------------------------------------------- startup
async function startRoom(roomId) {
  room = await loadRoom(roomId);
  if (!room) { toast("Room not found or you are not a member.", "error"); location.href = "index.html"; return; }

  $("#roomName").textContent = room.name;
  document.title = room.name + " — StudyBoard";
  if (myMember.role === "owner") $("#clearBtn").hidden = false;

  // ---- whiteboard
  const canvas = $("#board");
  board = new Whiteboard(canvas, {
    myUserId: me,
    canEraseOthers: false,
    onCommit: commitOp,
    onLive: (live) => send("live", { userId: me, live }),
    onCursor: throttle((w) => send("cursor", { userId: me, x: w.x, y: w.y, name: myMember.nickname, color: myColor }), 90),
    onToolChange: setActiveTool,
    onRequestContent: handleContentRequest,
  });

  // ---- sub-services
  chat = createChat({ roomId, me });
  timer = createTimer({ roomId, onError: (m) => toast(m, "error") });
  files = createFiles({ roomId, me });
  call = createCall({ getChannel: () => channel, myId: me, nickname: myMember.nickname, onPeers: renderCall, onStatus: (s) => { $("#callStatus").textContent = s; } });

  await loadPages();
  await renderChat();
  await refreshMembers();
  await refreshFiles();
  await loadTimer();
  if (myMember.role === "owner") await renderInvites();

  // ---- realtime
  setupChannel(roomId);

  // ---- UI
  buildSwatches();
  wireToolbar();
  wireSideTabs();
  wireChat();
  wireTimer();
  wireFiles();
  wireCall();
  wireSettings();
  wireCanvasHud();
  wireKeyboard();

  board.fit();

  // ---- heartbeat (presence + last_seen)
  heartbeat = setInterval(() => {
    sb.rpc("touch_presence", { p_room: roomId }).catch(() => {});
    trackPresence();
  }, 30000);
}

async function loadRoom(roomId) {
  const { data, error } = await sb.from("rooms")
    .select("id, name, owner_id, is_locked, settings, created_at, last_active_at")
    .eq("id", roomId).maybeSingle();
  if (error || !data) return null;
  return data;
}

function applyRoom(newRoom) {
  room = newRoom;
  $("#roomName").textContent = room.name;
  $("#setName").value = room.name;
  $("#setLocked").checked = !!room.is_locked;
}

// ------------------------------------------------------------------ channel
function send(event, payload) {
  channel?.send({ type: "broadcast", event, payload });
}

function setupChannel(roomId) {
  channel = sb.channel("room:" + roomId, {
    config: { presence: { key: me }, broadcast: { self: false } },
  });

  channel.on("broadcast", { event: "op" }, ({ payload }) => board.applyRemote(payload));
  channel.on("broadcast", { event: "live" }, ({ payload }) => board.applyLive(payload.userId, payload.live));
  channel.on("broadcast", { event: "cursor" }, ({ payload }) => board.setRemoteCursor(payload.userId, payload));
  channel.on("broadcast", { event: "rtc" }, ({ payload }) => {
    if (payload?.kind === "hello" || payload?.kind === "bye") { renderPresence(); }
    call.handleSignal(payload);
  });

  channel.on("presence", { event: "sync" }, renderPresence);
  channel.on("presence", { event: "leave" }, ({ key }) => board.removeRemoteCursor(key));

  channel.on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
    (p) => {
      if (p.eventType === "DELETE") { toast("This room was deleted by its owner.", "error"); setTimeout(() => location.href = "index.html", 1500); return; }
      if (p.new) applyRoom(p.new);
    });
  channel.on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` }, refreshMembers);
  channel.on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `room_id=eq.${roomId}` }, refreshFiles);
  channel.on("postgres_changes", { event: "*", schema: "public", table: "board_pages", filter: `room_id=eq.${roomId}` }, refreshPages);
  channel.on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
    (p) => { if (p.eventType === "INSERT") appendChat(p.new); });

  chat.subscribe((row) => appendChat(row));
  timer.subscribe(() => loadTimer());
  timer.startTicking(renderTimer);

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      setConn("online", "connected");
      trackPresence();
      await resync();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      setConn("warn", "reconnecting…");
    } else if (status === "CLOSED") {
      setConn("offline", "disconnected");
    }
  });
}

function trackPresence() {
  channel?.track({ nickname: myMember?.nickname, color: myColor, role: myMember?.role, inCall: call?.state.inCall, at: Date.now() }).catch(() => {});
}

// Reconcile after a (re)connect: refetch state that may have changed while we
// were away. Board objects are reloaded for the current page.
async function resync() {
  try {
    await refreshMembers();
    await loadTimer();
    await renderChat();
    await refreshFiles();
    if (currentPageId) board.setObjects(await loadPageObjects(currentPageId));
  } catch { /* transient */ }
}

function renderPresence() {
  const state = channel?.presenceState?.() || {};
  const online = new Set(Object.keys(state));
  renderPeople(online);
  $("#peerCount").textContent = String(Math.max(1, online.size));
}

// ---------------------------------------------------------------- whiteboard
async function commitOp(op) {
  try {
    if (op.op === "add") {
      const { error } = await sb.from("board_objects").insert({
        id: op.obj.id, room_id: room.id, page_id: currentPageId,
        author_id: me, kind: op.obj.kind, data: op.obj.data, z: op.obj.z || 0,
      });
      if (error) throw error;
    } else {
      const { error } = await sb.from("board_objects").delete().eq("id", op.obj.id);
      if (error) throw error;
    }
    send("op", op);
  } catch (e) {
    toast("Could not save that change: " + (e?.message || e), "error");
  }
}

async function loadPages() {
  const { data, error } = await sb.from("board_pages")
    .select("id, name, page_index").eq("room_id", room.id).order("page_index");
  if (error) throw error;
  pages = data || [];
  if (!pages.length) {
    const { data: id, error: e2 } = await sb.rpc("create_page", { p_room: room.id, p_name: "Page 1" });
    if (e2) throw e2;
    pages = [{ id, name: "Page 1", page_index: 0 }];
  }
  currentPageId = currentPageId && pages.find(p => p.id === currentPageId) ? currentPageId : pages[0].id;
  await switchPage(currentPageId);
  renderPageTabs();
}

async function loadPageObjects(pageId) {
  const { data, error } = await sb.from("board_objects")
    .select("id, kind, data, author_id, z").eq("page_id", pageId).eq("deleted", false);
  if (error) throw error;
  return data || [];
}

async function switchPage(pageId) {
  currentPageId = pageId;
  const objs = await loadPageObjects(pageId);
  board.setObjects(objs);
  renderPageTabs();
}

function renderPageTabs() {
  const host = $("#pageTabs");
  host.innerHTML = pages.map(p => `
    <button class="page-tab ${p.id === currentPageId ? "active" : ""}" data-page="${p.id}">${escapeHtml(p.name)}</button>
  `).join("") + `<button class="page-tab" id="addPage" title="Add page">＋</button>`;
  host.querySelectorAll("[data-page]").forEach(b => b.onclick = () => switchPage(b.dataset.page));
  $("#addPage").onclick = async () => {
    const name = await promptDialog({ title: "New page", label: "Page name", value: "Page " + (pages.length + 1), maxlength: 60 });
    if (!name) return;
    const { data, error } = await sb.rpc("create_page", { p_room: room.id, p_name: name });
    if (error) { toast(error.message, "error"); return; }
    await loadPages();
    await switchPage(data);
  };
}

async function refreshPages() { await loadPages(); }

function handleContentRequest(tool, world, cb) {
  if (tool === "text") {
    promptDialog({ title: "Add text", label: "Text", placeholder: "Write something…", maxlength: 500 })
      .then(t => t && cb({ x: world.x, y: world.y, text: t, color: board.color, size: 24 }));
  } else if (tool === "sticky") {
    promptDialog({ title: "Sticky note", label: "Note", placeholder: "Remember…", maxlength: 400 })
      .then(t => t && cb({ x: world.x, y: world.y, w: 220, h: 160, text: t, color: "#fde68a", size: 16 }));
  } else if (tool === "equation") {
    openEquationEditor().then(d => d && cb({ ...d, x: world.x, y: world.y }));
  } else if (tool === "graph") {
    openGraphEditor().then(d => d && cb({ ...d, x: world.x, y: world.y }));
  } else if (tool === "image") {
    pickImage().then(d => d && cb({ ...d, x: world.x, y: world.y }));
  }
}

function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1000;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve({ w, h, src: c.toDataURL("image/png") });
        };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    inp.click();
  });
}

// ---------------------------------------------------------------- chat panel
async function renderChat() {
  const host = $("#chatList");
  try {
    const rows = await chat.load(60);
    host.innerHTML = rows.map(chatHtml).join("");
    host.scrollTop = host.scrollHeight;
    await renderMathIn(host);
    $("#chatNote").textContent = rows.length ? "" : "No messages yet — say hello.";
  } catch (e) {
    host.innerHTML = `<p class="small muted">Could not load messages.</p>`;
  }
}

function chatHtml(m) {
  const mine = m.author_id === me;
  return `<div class="msg ${mine ? "mine" : ""}" data-id="${m.id}">
      <div class="meta"><span class="who" style="color:${colorFor(m.nickname)}">${escapeHtml(m.nickname)}</span><span>${fmtClock(m.created_at)}</span></div>
      <div class="body">${renderMessageBody(m.body, false)}</div>
    </div>`;
}

async function appendChat(m) {
  const host = $("#chatList");
  if (!m || host.querySelector(`[data-id="${m.id}"]`)) return;
  host.insertAdjacentHTML("beforeend", chatHtml(m));
  host.scrollTop = host.scrollHeight;
  await renderMathIn(host.lastElementChild);
}

function wireChat() {
  const form = $("#chatInput");
  const sendBtn = $("#chatSend");
  const doSend = async () => {
    const body = form.value.trim();
    if (!body) return;
    form.value = "";
    try {
      const row = await chat.send(body, myMember.nickname);
      if (row) appendChat(row);
    } catch (e) { toast("Message failed: " + e.message, "error"); }
  };
  sendBtn.onclick = doSend;
  form.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
}

// -------------------------------------------------------------- people panel
async function refreshMembers() {
  const { data, error } = await sb.from("room_members")
    .select("user_id, nickname, role, joined_at, last_seen_at")
    .eq("room_id", room.id).order("joined_at");
  if (error) return;
  members = data || [];
  const state = channel?.presenceState?.() || {};
  renderPeople(new Set(Object.keys(state)));
}

function renderPeople(online) {
  const host = $("#peopleList");
  $("#peopleCount").textContent = `(${members.length})`;
  host.innerHTML = members.map(m => {
    const isOnline = online.has(m.user_id);
    const isOwner = m.role === "owner";
    const canRemove = myMember.role === "owner" && !isOwner;
    return `<div class="person">
      <span class="avatar" style="background:${colorFor(m.nickname)}">${escapeHtml(initials(m.nickname))}</span>
      <span class="grow">
        <strong>${escapeHtml(m.nickname)}</strong>${m.user_id === me ? ' <span class="muted small">(you)</span>' : ""}
        <span class="muted small" style="display:block">
          <span class="dot ${isOnline ? "online" : "offline"}"></span>
          ${isOnline ? "online" : "away"}${isOwner ? " · owner" : ""}
        </span>
      </span>
      ${canRemove ? `<button class="btn sm danger" data-remove="${m.user_id}">Remove</button>` : ""}
    </div>`;
  }).join("");
  host.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => removeMember(b.dataset.remove));
}

async function removeMember(userId) {
  if (!await confirmDialog({ title: "Remove member", body: "They will lose access to this room immediately.", confirmText: "Remove", danger: true })) return;
  const { error } = await sb.rpc("remove_member", { p_room: room.id, p_user: userId });
  if (error) { toast(error.message, "error"); return; }
  toast("Member removed.", "ok");
  refreshMembers();
}

// ---------------------------------------------------------------- files panel
async function refreshFiles() {
  const host = $("#fileList");
  try {
    const docs = await files.list();
    if (!docs.length) { host.innerHTML = `<p class="small muted">No files shared yet.</p>`; return; }
    host.innerHTML = docs.map(d => `
      <div class="file-item">
        <span class="grow">
          <strong>${escapeHtml(d.name)}</strong>
          <span class="muted small" style="display:block">${fmtBytes(d.size_bytes)} · ${fmtClock(d.created_at)}</span>
        </span>
        <button class="btn sm" data-open="${d.id}">Open</button>
        <button class="btn sm danger" data-del="${d.id}">Delete</button>
      </div>`).join("");
    host.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openDocument(docs.find(d => d.id === b.dataset.open)));
    host.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const d = docs.find(x => x.id === b.dataset.del);
      if (await confirmDialog({ title: "Delete file", body: `Delete “${d.name}” for everyone?`, confirmText: "Delete", danger: true })) {
        try { await files.remove(d); refreshFiles(); } catch (e) { toast(e.message, "error"); }
      }
    });
  } catch (e) { host.innerHTML = `<p class="small muted">Could not load files.</p>`; }
}

function wireFiles() {
  const drop = $("#dropZone");
  const input = $("#fileInput");
  $("#pickFile").onclick = () => input.click();
  input.onchange = () => { if (input.files?.[0]) doUpload(input.files[0]); input.value = ""; };
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hover"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("hover"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) doUpload(f); });
}

async function doUpload(file) {
  try {
    files.validate(file);
    toast("Uploading " + file.name + "…");
    const doc = await files.upload(file);
    toast("Uploaded.", "ok");
    refreshFiles();
    if (doc.mime === "application/pdf" || doc.mime.startsWith("image/")) openDocument(doc);
  } catch (e) { toast(e.message, "error"); }
}

async function openDocument(doc) {
  if (doc.mime.startsWith("image/")) return openImageDoc(doc);
  return openPdfDoc(doc);
}

function openImageDoc(doc) {
  openModal({
    title: doc.name,
    html: `<div class="center"><img id="docImg" alt="${escapeHtml(doc.name)}" style="max-width:100%;border-radius:10px" /></div>
      <p class="small muted">Right-click / long-press to save, or use “Place on board” in the toolbar to drop it on the canvas.</p>`,
    wire: async (root) => {
      try { root.querySelector("#docImg").src = await files.signedUrl(doc, 3600); }
      catch (e) { root.querySelector("#docImg").replaceWith(Object.assign(document.createElement("p"), { textContent: "Could not load: " + e.message })); }
    },
  });
}

async function openPdfDoc(doc) {
  const close = openModal({
    title: doc.name,
    html: `<div class="row" style="margin-bottom:.5rem">
        <button class="btn sm" id="pdfPrev">‹</button>
        <span class="pill">Page <span id="pdfPage">1</span> / <span id="pdfCount">?</span></span>
        <button class="btn sm" id="pdfNext">›</button>
        <span class="spacer"></span>
        <button class="btn sm" id="pdfAnno">✏️ Annotate</button>
        <button class="btn sm" id="pdfClear">Clear annotations</button>
      </div>
      <div class="pdf-stage" id="pdfStage" style="width:100%;height:60dvh">
        <canvas id="pdf-canvas"></canvas>
        <canvas id="pdf-anno" style="touch-action:none"></canvas>
      </div>
      <p class="small muted">Annotations are stored separately from the file and shared with everyone in the room.</p>`,
  });

  try {
    const pdfjs = await loadPdfJs();
    const url = await files.signedUrl(doc, 3600);
    const task = pdfjs.getDocument(url);
    const pdf = await task.promise;
    let pageNo = 1;
    let scale = 1.4;
    const cvs = $("#pdf-canvas");
    const anno = $("#pdf-anno");
    let annotating = false;
    let strokes = [];

    $("#pdfCount").textContent = pdf.numPages;

    const renderPage = async () => {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      cvs.width = anno.width = viewport.width * dpr;
      anno.height = viewport.height * dpr;
      cvs.height = viewport.height * dpr;
      cvs.style.width = anno.style.width = viewport.width + "px";
      cvs.style.height = anno.style.height = viewport.height + "px";
      const ctx = cvs.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;
      await loadAnnotations(pageNo);
      drawAnnotations();
    };

    const loadAnnotations = async (page) => {
      const { data } = await sb.from("annotations")
        .select("id, data, author_id").eq("document_id", doc.id).eq("page_number", page);
      strokes = (data || []).map(r => ({ id: r.id, ...r.data }));
    };

    const drawAnnotations = () => {
      const dpr = window.devicePixelRatio || 1;
      const ctx = anno.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, anno.width, anno.height);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (const s of strokes) {
        ctx.strokeStyle = s.color || "#dc2626";
        ctx.lineWidth = s.width || 2;
        ctx.beginPath();
        s.points.forEach(([x, y], i) => i ? ctx.lineTo(x * anno.width, y * anno.height) : ctx.moveTo(x * anno.width, y * anno.height));
        ctx.stroke();
      }
    };

    // normalised (0..1) coordinates so annotations survive zoom / device changes
    let cur = null;
    const pos = (e) => {
      const r = anno.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    anno.addEventListener("pointerdown", (e) => {
      if (!annotating) return;
      anno.setPointerCapture(e.pointerId);
      cur = { points: [pos(e)], color: "#dc2626", width: 2, page: pageNo };
      drawAnnotations();
      const ctx = anno.getContext("2d");
      ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(...cur.points[0].map((v, i) => v * (i ? anno.height : anno.width)));
    });
    anno.addEventListener("pointermove", (e) => {
      if (!cur) return;
      cur.points.push(pos(e));
      drawAnnotations();
    });
    anno.addEventListener("pointerup", async () => {
      if (!cur) return;
      const s = cur; cur = null;
      if (s.points.length < 2) return;
      strokes.push(s); drawAnnotations();
      const { error } = await sb.from("annotations").insert({
        room_id: room.id, document_id: doc.id, page_number: s.page,
        author_id: me, data: { points: s.points, color: s.color, width: s.width },
      });
      if (error) toast("Could not save annotation: " + error.message, "error");
    });

    $("#pdfPrev").onclick = async () => { if (pageNo > 1) { pageNo--; $("#pdfPage").textContent = pageNo; await renderPage(); } };
    $("#pdfNext").onclick = async () => { if (pageNo < pdf.numPages) { pageNo++; $("#pdfPage").textContent = pageNo; await renderPage(); } };
    $("#pdfAnno").onclick = () => { annotating = !annotating; $("#pdfAnno").classList.toggle("primary", annotating); toast(annotating ? "Annotation mode on." : "Annotation mode off."); };
    $("#pdfClear").onclick = async () => {
      if (!await confirmDialog({ title: "Clear annotations", body: "Remove every annotation on this page?", confirmText: "Clear", danger: true })) return;
      const { error } = await sb.from("annotations").delete().eq("document_id", doc.id).eq("page_number", pageNo);
      if (error) { toast(error.message, "error"); return; }
      strokes = []; drawAnnotations();
    };

    await renderPage();
  } catch (e) {
    toast("Could not open the PDF: " + (e?.message || e), "error");
  }
}

let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  // pdf.js v3 UMD build attaches window.pdfjsLib when loaded as a classic script.
  pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return reject(new Error("pdf.js failed to initialise"));
      lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      resolve(lib);
    };
    s.onerror = () => reject(new Error("Could not load pdf.js"));
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

// --------------------------------------------------------------- timer panel
async function loadTimer() {
  try { await timer.load(); renderTimer(timer.remaining(), timer.state); }
  catch (e) { /* ignore */ }
}

function renderTimer(rem, st) {
  if (!st) return;
  $("#timerFace").textContent = fmtTime(rem);
  const pct = st.duration_seconds ? Math.max(0, Math.min(100, (rem / st.duration_seconds) * 100)) : 0;
  $("#timerBar").style.width = pct + "%";
  $("#timerMode").textContent = st.mode === "break" ? "Break" : "Focus";
  $("#timerState").textContent = st.running ? "running" : (rem <= 0 ? "done" : "paused");
  $("#timerStart").textContent = st.running ? "Pause" : (rem < (st.duration_seconds || 0) && rem > 0 ? "Resume" : "Start");
}

function wireTimer() {
  $("#timerStart").onclick = async () => {
    const st = timer.state;
    const rem = timer.remaining();
    const action = st?.running ? "pause" : (rem > 0 && rem < (st?.duration_seconds || 0) ? "resume" : "start");
    await timer.control(action);
    loadTimer();
  };
  $("#timerReset").onclick = async () => { await timer.control("reset"); loadTimer(); };
  $("#timerSkip").onclick = async () => { await timer.control("skip"); loadTimer(); };
  $("#timerApply").onclick = async () => {
    const min = Math.max(1, Math.min(120, Number($("#focusMin").value) || 25));
    await timer.control("set_duration", min * 60);
    loadTimer();
  };
}

// ---------------------------------------------------------------- call panel
function wireCall() {
  $("#callJoin").onclick = async () => {
    try {
      await call.join({ video: false });
      $("#callJoin").disabled = true;
      $("#callMic").disabled = $("#callCam").disabled = $("#callLeave").disabled = false;
      trackPresence();
    } catch { /* status already set */ }
  };
  $("#callMic").onclick = () => { const on = call.toggleMic(); $("#callMic").textContent = on ? "Mute" : "Unmute"; trackPresence(); };
  $("#callCam").onclick = async () => { const on = await call.toggleCam(); $("#callCam").textContent = on ? "Camera off" : "Camera on"; renderCall(call.state); };
  $("#callLeave").onclick = async () => {
    await call.leave();
    $("#callJoin").disabled = false;
    $("#callMic").disabled = $("#callCam").disabled = $("#callLeave").disabled = true;
    renderCall(call.state);
    trackPresence();
  };
}

function renderCall({ inCall, peers, streams }) {
  $("#callPeers").innerHTML = inCall
    ? `<p class="small muted">In call with ${peers.length} other${peers.length === 1 ? "" : "s"}.</p>`
    : "";
  const grid = $("#videoGrid");
  grid.innerHTML = "";
  if (!inCall) return;
  const local = call.getLocalStream();
  if (local && local.getVideoTracks().length) {
    const v = document.createElement("video");
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.srcObject = local; v.style.cssText = "width:140px;border-radius:10px;background:#000";
    grid.appendChild(v);
  }
  streams.forEach((stream, peerId) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<video autoplay playsinline style="width:140px;border-radius:10px;background:#000"></video>`;
    const v = wrap.querySelector("video");
    v.srcObject = stream;
    grid.appendChild(wrap);
  });
}

// ------------------------------------------------------------ settings panel
function wireSettings() {
  $("#setName").value = room.name;
  $("#setLocked").checked = !!room.is_locked;
  $("#deleteRoom").hidden = myMember.role !== "owner";

  $("#saveName").onclick = async () => {
    const name = $("#setName").value.trim();
    if (!name) return;
    const { error } = await sb.from("rooms").update({ name }).eq("id", room.id);
    if (error) { toast(error.message, "error"); return; }
    toast("Room name saved.", "ok");
  };

  $("#setLocked").onchange = async (e) => {
    const { error } = await sb.rpc("set_room_locked", { p_room: room.id, p_locked: e.target.checked });
    if (error) { toast(error.message, "error"); e.target.checked = !e.target.checked; }
  };

  $("#rotateInvite").onclick = async () => {
    if (!await confirmDialog({ title: "Rotate invite link", body: "Every existing invitation link stops working immediately.", confirmText: "Rotate" })) return;
    const { data, error } = await sb.rpc("rotate_invite", { p_room: room.id });
    if (error) { toast(error.message, "error"); return; }
    rememberCode(room.id, data);
    toast("New invite link ready.", "ok");
    await renderInvites();
    shareInvite();
  };

  $("#copyInvite").onclick = () => shareInvite();

  $("#shareBtn").onclick = () => shareInvite();

  $("#leaveRoom").onclick = async () => {
    if (myMember.role === "owner") { toast("Owners must delete the room instead.", "error"); return; }
    if (!await confirmDialog({ title: "Leave room", body: "You can rejoin later with a valid invite link.", confirmText: "Leave", danger: true })) return;
    const { error } = await sb.rpc("leave_room", { p_room: room.id });
    if (error) { toast(error.message, "error"); return; }
    location.href = "index.html";
  };

  $("#deleteRoom").onclick = async () => {
    if (!await confirmDialog({ title: "Delete room", body: "This permanently deletes the room, its board, chat and files. Cannot be undone.", confirmText: "Delete room", danger: true })) return;
    const { error } = await sb.rpc("delete_room", { p_room: room.id });
    if (error) { toast(error.message, "error"); return; }
    location.href = "index.html";
  };
}

async function renderInvites() {
  const host = $("#inviteList");
  const { data, error } = await sb.from("invite_codes")
    .select("id, code_prefix, created_at, revoked, uses, expires_at")
    .eq("room_id", room.id).order("created_at", { ascending: false }).limit(20);
  if (error) { host.textContent = ""; return; }
  host.innerHTML = (data || []).map(i => `
    <div class="row" style="gap:.4rem;margin:.2rem 0">
      <span class="pill">${escapeHtml(i.code_prefix)}…</span>
      <span class="muted">${i.revoked ? "revoked" : "active"} · ${i.uses} uses · ${fmtClock(i.created_at)}</span>
      <span class="spacer"></span>
      ${i.revoked ? "" : `<button class="btn sm danger" data-rev="${i.id}">Revoke</button>`}
    </div>`).join("") || `<p class="small muted">No invitations yet.</p>`;
  host.querySelectorAll("[data-rev]").forEach(b => b.onclick = async () => {
    const { error } = await sb.rpc("revoke_invite", { p_invite: b.dataset.rev });
    if (error) { toast(error.message, "error"); return; }
    renderInvites();
  });
}

async function shareInvite() {
  let code = recallCode(room.id);
  if (!code) {
    if (myMember.role !== "owner") { toast("Ask the room owner to share an invite link.", "error"); return; }
    if (!await confirmDialog({ title: "No active code stored", body: "Only a hash of each code is kept, so the current link cannot be shown. Generate a fresh one?", confirmText: "Generate" })) return;
    const { data, error } = await sb.rpc("rotate_invite", { p_room: room.id });
    if (error) { toast(error.message, "error"); return; }
    code = data; rememberCode(room.id, code);
    await renderInvites();
  }
  const link = new URL("room.html?invite=" + code, location.href).toString();
  try {
    if (navigator.share) { await navigator.share({ title: room.name, text: "Join my StudyBoard room", url: link }); return; }
    await navigator.clipboard.writeText(link);
    toast("Invite link copied.", "ok");
  } catch {
    await promptDialog({ title: "Invite link", label: "Share this link", value: link, maxlength: 400 });
  }
}

// ---------------------------------------------------------------- toolbar/UI
function buildSwatches() {
  const host = $("#swatches");
  host.innerHTML = PALETTE.map((c, i) => `<span class="swatch ${i === 0 ? "active" : ""}" data-color="${c}" style="background:${c}"></span>`).join("");
  host.querySelectorAll("[data-color]").forEach(s => s.onclick = () => {
    board.setColor(s.dataset.color);
    host.querySelectorAll(".swatch").forEach(x => x.classList.remove("active"));
    s.classList.add("active");
  });
}

function wireToolbar() {
  $$("#toolbar [data-tool]").forEach(b => b.onclick = () => { board.setTool(b.dataset.tool); setActiveTool(b.dataset.tool); });
  $("#strokeWidth").oninput = (e) => board.setWidth(e.target.value);
  $("#undoBtn").onclick = () => board.undo();
  $("#redoBtn").onclick = () => board.redo();
  $("#clearBtn").onclick = async () => {
    if (!await confirmDialog({ title: "Clear page", body: "Erase everything on this page for everyone?", confirmText: "Clear", danger: true })) return;
    const { error } = await sb.rpc("clear_board", { p_room: room.id, p_page: currentPageId });
    if (error) { toast(error.message, "error"); return; }
    await switchPage(currentPageId);
  };
}

function setActiveTool(tool) {
  $$("#toolbar [data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
}

function wireSideTabs() {
  $$(".side-tab").forEach(t => t.onclick = () => {
    $$(".side-tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    $$(".side-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === t.dataset.panel));
  });
  const side = $("#side"), scrim = $("#sideScrim");
  const open = () => { side.classList.add("open"); scrim.classList.remove("hidden"); };
  const close = () => { side.classList.remove("open"); scrim.classList.add("hidden"); };
  $("#sideToggle").onclick = () => side.classList.contains("open") ? close() : open();
  scrim.onclick = close;
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function wireCanvasHud() {
  $("#zoomIn").onclick = () => board.zoomBy(1.2, board.canvas.width / 4, board.canvas.height / 4);
  $("#zoomOut").onclick = () => board.zoomBy(1 / 1.2, board.canvas.width / 4, board.canvas.height / 4);
  $("#fitBtn").onclick = () => board.centerOnContent();
  const hud = $(".canvas-hud");
  const exportWrap = document.createElement("span");
  exportWrap.className = "row";
  exportWrap.style.gap = ".3rem";
  exportWrap.innerHTML = `<button class="btn sm" id="expPng">PNG</button><button class="btn sm" id="expPdf">PDF</button><button class="btn sm" id="formulas">Formulas</button>`;
  hud.appendChild(exportWrap);
  $("#expPng").onclick = async () => {
    const blob = await board.renderToBlob({ scale: 2 });
    downloadBlob(blob, `${safeName(room.name)}-board.png`);
  };
  $("#expPdf").onclick = async () => {
    try {
      const blob = await board.renderToBlob({ scale: 2 });
      const { jsPDF } = await loadJsPdf();
      const dataUrl = await blobToDataUrl(blob);
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = dataUrl; });
      const pdf = new jsPDF({ orientation: img.width > img.height ? "landscape" : "portrait", unit: "px", format: [img.width, img.height] });
      pdf.addImage(dataUrl, "PNG", 0, 0, img.width, img.height);
      pdf.save(`${safeName(room.name)}-board.pdf`);
    } catch (e) { toast("PDF export failed: " + e.message, "error"); }
  };
  $("#formulas").onclick = () => openFormulaReference((tex) => {
    texToSvg(tex).then(d => {
      board.addLocal({ id: randomId(), kind: "equation", data: { ...d, x: 60, y: 60 }, author: me, z: Date.now() });
    });
  });

  // keep the zoom label fresh
  setInterval(() => { $("#zoomLabel").textContent = Math.round(board.cam.zoom * 100) + "%"; }, 400);
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target && /INPUT|TEXTAREA|MATH-FIELD/.test(e.target.tagName)) return;
    if (e.key === "Escape") { /* modals handle their own */ }
  });
}

// -------------------------------------------------------------------- helpers
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function blobToDataUrl(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
function safeName(s) { return String(s || "board").replace(/[^\w\-]+/g, "_").slice(0, 60); }

let jspdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  if (jspdfPromise) return jspdfPromise;
  jspdfPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2/dist/jspdf.umd.min.js";
    s.onload = () => window.jspdf ? resolve(window.jspdf) : reject(new Error("jsPDF missing"));
    s.onerror = () => reject(new Error("Could not load jsPDF"));
    document.head.appendChild(s);
  });
  return jspdfPromise;
}

function friendly(e) {
  const m = (e?.message || String(e)).toLowerCase();
  if (m.includes("invite code not found")) return "No room matches that code.";
  if (m.includes("revoked")) return "That invitation link was revoked.";
  if (m.includes("expired")) return "That invitation link has expired.";
  if (m.includes("locked")) return "This room is locked.";
  if (m.includes("rate limit")) return "Too many attempts — please wait a moment.";
  return e?.message || "Something went wrong.";
}

addEventListener("beforeunload", () => {
  if (heartbeat) clearInterval(heartbeat);
  try { call?.destroy(); } catch {}
  try { board?.destroy(); } catch {}
});
