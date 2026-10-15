// =============================================================================
// Identity.
//
// Primary: Google sign-in. The account is durable — the same Google account is
// the same user id on every device and after any amount of browser cleaning, so
// rooms, boards and files stay yours. This is the fix for an anonymous session
// silently becoming a different person.
//
// The original account-free anonymous sign-in is kept behind AUTH_MODE =
// "google-or-anonymous" for the "join with just a nickname" flow, but it is OFF
// by default: it is exactly what caused identity to be unreliable.
//
// Nothing here ever creates an identity as a side effect of loading a page. A
// page load either finds a session or asks you to sign in — it never quietly
// mints a new user, which is how access used to disappear without warning.
// =============================================================================
import { sb } from "./supabase-client.js";
import { AUTH_MODE } from "./config.js";

let _user = null;

export function currentUser() { return _user; }
export function userId() { return _user?.id ?? null; }

export function displayName(user = _user) {
  const m = user?.user_metadata || {};
  return m.full_name || m.name || m.user_name ||
    (user?.email ? String(user.email).split("@")[0] : "Student");
}

export function userEmail(user = _user) { return user?.email || null; }

// Reads the stored session. Returns the user, or null. Never signs anyone in.
export async function loadSession() {
  const { data: { session } } = await sb.auth.getSession();
  _user = session?.user ?? null;
  return _user;
}

export async function requireSession() {
  return await loadSession();
}

export async function signInWithGoogle(redirectTo) {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo || (location.origin + location.pathname),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw new Error(googleHelp(error));
}

export function anonymousAllowed() { return AUTH_MODE === "google-or-anonymous"; }

export async function signInAnonymously() {
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(error.message);
  _user = data.user;
  return _user;
}

export async function signOut() {
  try { await sb.auth.signOut(); } catch { /* already gone */ }
  _user = null;
}

// OAuth failures come back in the URL rather than as a thrown error. Read them
// once, then strip them so a refresh doesn't resurrect the message.
export function oauthErrorFromUrl() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const desc = q.get("error_description") || h.get("error_description");
  const code = q.get("error") || h.get("error");
  if (!desc && !code) return null;
  history.replaceState(null, "", location.pathname);
  return decodeURIComponent(desc || code);
}

function googleHelp(error) {
  const m = String(error?.message || error);
  if (/not enabled|provider is not enabled|unsupported provider/i.test(m)) {
    return "Google sign-in isn't enabled on this Supabase project yet. Turn it on in "
      + "Authentication → Sign In / Providers → Google and paste your Google client ID and secret.";
  }
  if (/redirect|not allowed/i.test(m)) {
    return "This site's URL isn't in the Supabase redirect allow-list. Add it under "
      + "Authentication → URL Configuration → Redirect URLs.";
  }
  return m;
}
