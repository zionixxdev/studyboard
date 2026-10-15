// =============================================================================
// The authentication screen: sign in, create account, password reset, and the
// "set a new password" step after following a recovery link.
//
// It is a full-screen, non-dismissible gate. Without an identity there is
// nothing to show, and inventing one silently is what made rooms stop
// recognising their own owner.
// =============================================================================
import { escapeHtml } from "./util.js";

let gateEl = null;

export function showAuthGate(handlers = {}) {
  if (gateEl) gateEl.remove();          // only ever one gate

  const root = document.createElement("div");
  root.className = "modal-scrim";
  root.id = "authGate";
  document.body.appendChild(root);
  gateEl = root;

  const state = {
    mode: handlers.recovery ? "recovery" : (handlers.mode || "signin"),
    busy: false,
    error: handlers.error || null,
    notice: handlers.notice || null,
  };

  function render() {
    root.innerHTML = view();
    wire();
  }

  async function run(fn, ...args) {
    if (!fn || state.busy) return;
    state.busy = true; state.error = null; state.notice = null;
    render();
    try {
      const res = await fn(...args);
      if (res && res.notice) { state.busy = false; state.notice = res.notice; render(); }
      // Otherwise the handler navigated or reloaded — nothing left to do.
    } catch (e) {
      state.busy = false;
      state.error = e?.message || String(e);
      render();
    }
  }

  function noticeBlock() {
    if (state.error) return `<p class="auth-msg err">${escapeHtml(state.error)}</p>`;
    if (state.notice) return `<p class="auth-msg ok">${escapeHtml(state.notice)}</p>`;
    return "";
  }

  function googleBlock() {
    if (!handlers.google || state.mode === "recovery" || state.mode === "reset") return "";
    return `
      <div class="auth-or"><span>or</span></div>
      <button class="btn auth-wide" id="agGoogle" type="button">Continue with Google</button>`;
  }

  function view() {
    const busy = state.busy ? " disabled" : "";

    if (state.mode === "recovery") {
      return `<div class="modal auth-modal" role="dialog" aria-modal="true">
        <div class="auth-brand"><span class="logo">S</span> StudyBoard</div>
        <h2>Set a new password</h2>
        <p class="small muted">Choose a new password for your account.</p>
        ${noticeBlock()}
        <label for="agPw1">New password</label>
        <input class="input" id="agPw1" type="password" autocomplete="new-password" minlength="6" />
        <label for="agPw2">Confirm password</label>
        <input class="input" id="agPw2" type="password" autocomplete="new-password" minlength="6" />
        <p><button class="btn primary auth-wide" id="agSave"${busy}>Save new password</button></p>
      </div>`;
    }

    if (state.mode === "reset") {
      return `<div class="modal auth-modal" role="dialog" aria-modal="true">
        <div class="auth-brand"><span class="logo">S</span> StudyBoard</div>
        <h2>Reset your password</h2>
        <p class="small muted">We'll email you a link to set a new one.</p>
        ${noticeBlock()}
        <label for="agEmail">Email</label>
        <input class="input" id="agEmail" type="email" autocomplete="email" />
        <p><button class="btn primary auth-wide" id="agReset"${busy}>Send reset link</button></p>
        <p class="small muted center"><a href="#" id="agBack">Back to sign in</a></p>
      </div>`;
    }

    const isSignup = state.mode === "signup";
    return `<div class="modal auth-modal" role="dialog" aria-modal="true">
      <div class="auth-brand"><span class="logo">S</span> StudyBoard</div>
      <div class="auth-tabs">
        <button class="auth-tab ${isSignup ? "" : "active"}" id="agTabIn" type="button">Sign in</button>
        <button class="auth-tab ${isSignup ? "active" : ""}" id="agTabUp" type="button">Create account</button>
      </div>
      <p class="small muted">${isSignup
        ? "Create an account so your rooms, boards and files are yours on any device."
        : "Sign in to your StudyBoard account."}</p>
      ${noticeBlock()}
      ${isSignup ? `<label for="agName">Your name</label>
        <input class="input" id="agName" autocomplete="name" maxlength="60" placeholder="e.g. Aditya Shakya" />` : ""}
      <label for="agEmail">Email</label>
      <input class="input" id="agEmail" type="email" autocomplete="email" placeholder="you@example.com" />
      <label for="agPassword">Password</label>
      <input class="input" id="agPassword" type="password"
             autocomplete="${isSignup ? "new-password" : "current-password"}"
             ${isSignup ? 'minlength="6" placeholder="at least 6 characters"' : ""} />
      <p><button class="btn primary auth-wide" id="agSubmit"${busy}>${isSignup ? "Create account" : "Sign in"}</button></p>
      ${isSignup ? "" : `<p class="small muted center"><a href="#" id="agForgot">Forgot your password?</a></p>`}
      ${googleBlock()}
      <p class="small muted center" style="margin-top:.9rem">We use your name and email only to identify you to the people in your rooms.</p>
    </div>`;
  }

  function val(id) { const el = root.querySelector(id); return el ? el.value.trim() : ""; }

  function wire() {
    const on = (sel, ev, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener(ev, fn); };

    on("#agTabIn", "click", () => { state.mode = "signin"; state.error = null; render(); });
    on("#agTabUp", "click", () => { state.mode = "signup"; state.error = null; render(); });
    on("#agBack", "click", (e) => { e.preventDefault(); state.mode = "signin"; state.error = null; render(); });
    on("#agForgot", "click", (e) => { e.preventDefault(); state.mode = "reset"; state.error = null; render(); });
    on("#agGoogle", "click", () => run(handlers.google));

    const submit = () => {
      const email = val("#agEmail");
      const password = root.querySelector("#agPassword")?.value || "";
      if (!email) { state.error = "Enter your email."; render(); return; }
      if (state.mode === "signup") {
        const name = val("#agName");
        if (password.length < 6) { state.error = "Use at least 6 characters for your password."; render(); return; }
        run(handlers.signUp, email, password, name);
      } else {
        if (!password) { state.error = "Enter your password."; render(); return; }
        run(handlers.signIn, email, password);
      }
    };
    on("#agSubmit", "click", submit);
    on("#agPassword", "keydown", (e) => { if (e.key === "Enter") submit(); });
    on("#agEmail", "keydown", (e) => { if (e.key === "Enter") submit(); });

    on("#agReset", "click", () => {
      const email = val("#agEmail");
      if (!email) { state.error = "Enter your email."; render(); return; }
      run(handlers.reset, email);
    });

    on("#agSave", "click", () => {
      const p1 = root.querySelector("#agPw1")?.value || "";
      const p2 = root.querySelector("#agPw2")?.value || "";
      if (p1.length < 6) { state.error = "Use at least 6 characters."; render(); return; }
      if (p1 !== p2) { state.error = "The two passwords don't match."; render(); return; }
      run(handlers.setPassword, p1);
    });
  }

  render();

  return {
    close() { root.remove(); if (gateEl === root) gateEl = null; },
    setError(m) { state.error = m; state.busy = false; render(); },
    setNotice(m) { state.notice = m; state.busy = false; render(); },
  };
}

// Shared by both pages: turns a page's auth requirements into gate handlers.
export function authGateHandlers(auth, { recovery = false, error = null } = {}) {
  return {
    recovery,
    error,
    signIn: async (email, password) => { await auth.signInWithPassword(email, password); location.reload(); },
    signUp: async (email, password, name) => {
      const r = await auth.signUpWithPassword(email, password, name);
      if (r.needsConfirmation) {
        return { notice: "Account created. Check your email for the confirmation link, then sign in." };
      }
      location.reload();
    },
    google: () => auth.signInWithGoogle(),
    reset: async (email) => {
      await auth.sendPasswordReset(email);
      return { notice: "If that email has an account, a reset link is on its way." };
    },
    setPassword: async (password) => {
      await auth.updatePassword(password);
      auth.cleanUrl();
      location.reload();
    },
  };
}
