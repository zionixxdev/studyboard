// =============================================================================
// Identity — email + password, and Google.
//
// This is a real account system: sign up, sign in, password reset, sign out.
// A user id is durable and tied to the account, not to this browser's storage,
// so rooms, boards and files stay yours across devices and after clearing data.
//
// Nothing here ever creates an identity as a side effect of loading a page.
// A page load either finds a session or shows the sign-in gate. Silently
// minting a user is what made a room stop recognising its own owner.
// =============================================================================
import { sb } from "./supabase-client.js";

let _user = null;

export function currentUser() { return _user; }
export function userId() { return _user?.id ?? null; }

export function displayName(user = _user) {
  const m = user?.user_metadata || {};
  return m.full_name || m.name || m.user_name ||
    (user?.email ? String(user.email).split("@")[0] : "Student");
}
export function userEmail(user = _user) { return user?.email || null; }

// -----------------------------------------------------------------------------
// URL-borne auth state (OAuth return, email confirmation, password recovery).
// Read synchronously at module load — supabase-js consumes and rewrites the URL
// once its async init finishes, so anything read later may already be gone.
// -----------------------------------------------------------------------------
const URL_STATE = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const pick = (k) => q.get(k) || h.get(k);
    const error = pick("error_description") || pick("error");
    const type = pick("type");
    const hasTokens = h.has("access_token") || q.has("code") || h.has("code");
    if (!error && !type && !hasTokens) return null;
    return {
      error: error ? decodeURIComponent(error) : null,
      type,                       // "recovery" | "signup" | "email_change" | "invite"
      hasTokens,
    };
  } catch { return null; }
})();

export function initialUrlState() { return URL_STATE; }
export function cleanUrl() {
  try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Session
// -----------------------------------------------------------------------------
export async function loadSession() {
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) { _user = null; return null; }
    _user = data?.session?.user ?? null;
    return _user;
  } catch { _user = null; return null; }
}

export async function requireSession() { return await loadSession(); }

export async function signOut() {
  try { await sb.auth.signOut(); } catch { /* already gone */ }
  _user = null;
}

// -----------------------------------------------------------------------------
// Email + password
// -----------------------------------------------------------------------------
export async function signUpWithPassword(email, password, name) {
  const { data, error } = await sb.auth.signUp({
    email: String(email).trim().toLowerCase(),
    password,
    options: {
      data: { full_name: (name || "").trim() || null },
      emailRedirectTo: location.origin + location.pathname,
    },
  });
  if (error) throw new Error(authHelp(error));
  _user = data?.session?.user ?? null;
  // With "Confirm email" on, Supabase returns a user but no session until the
  // link is clicked. That is a success, not a failure — say so.
  return { needsConfirmation: !data?.session };
}

export async function signInWithPassword(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(authHelp(error));
  _user = data.user;
  return _user;
}

export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), {
    redirectTo: location.origin + location.pathname,
  });
  if (error) throw new Error(authHelp(error));
}

export async function updatePassword(newPassword) {
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(authHelp(error));
}

// -----------------------------------------------------------------------------
// Google
// -----------------------------------------------------------------------------
export async function signInWithGoogle(redirectTo) {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo || (location.origin + location.pathname),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw new Error(authHelp(error));
}

// -----------------------------------------------------------------------------
// Is a failed request an auth failure rather than "no rows"? A 401/expired JWT
// must send the user back to sign in — never be mistaken for "not a member",
// which is what used to demand an invite code from a room's own owner.
// -----------------------------------------------------------------------------
export function isAuthError(error) {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 401 || status === 403) return true;
  const m = String(error.message || error);
  return /jwt|token|expired|not authenticated|invalid claim|no api key/i.test(m);
}

function authHelp(error) {
  const m = String(error?.message || error);
  if (/invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox for the link.";
  if (/already registered|already been registered|user already/i.test(m)) return "That email already has an account. Sign in instead.";
  if (/password should be at least/i.test(m)) return "Password is too short — use at least 6 characters.";
  if (/unable to validate email|invalid email/i.test(m)) return "That doesn't look like a valid email address.";
  if (/not enabled|unsupported provider/i.test(m)) return "Google sign-in isn't enabled on this Supabase project yet (Authentication → Sign In / Providers → Google).";
  if (/redirect|not allowed/i.test(m)) return "This site's URL isn't listed in Supabase → Authentication → URL Configuration → Redirect URLs.";
  if (/rate limit|too many|for security purposes/i.test(m)) return "Too many attempts — wait a moment and try again.";
  if (/email.*disabled|signups not allowed/i.test(m)) return "Email sign-up is turned off on this Supabase project (Authentication → Sign In / Providers → Email).";
  return m;
}
