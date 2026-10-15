// Anonymous, account-free identity. Each browser gets a stable user id that
// Supabase stores in localStorage; clearing site data creates a new identity
// and loses ownership of rooms created under the old one.
import { sb } from "./supabase-client.js";

let _user = null;

export async function ensureSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) { _user = session.user; return _user; }

  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    throw new Error(
      "Anonymous sign-in failed: " + error.message +
      " — enable it in Supabase → Authentication → Sign In / Providers → Anonymous."
    );
  }
  _user = data.user;
  return _user;
}

export function currentUser() { return _user; }
export function userId() { return _user?.id ?? null; }
