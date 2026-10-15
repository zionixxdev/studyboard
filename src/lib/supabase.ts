import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when both required Supabase env vars are present. When false the app
 * renders a setup screen instead of pretending to work — see App.tsx.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * The Supabase client used by the browser.
 *
 * Only the URL and the *anon public* key are used here. The anon key is safe to
 * ship: every table is protected by Row Level Security, so it can only read and
 * write what the signed-in user is allowed to. The service_role key must never
 * be imported into frontend code.
 *
 * Session persistence uses the official client's default (localStorage) with
 * automatic token refresh, which gives "remember me" behaviour securely.
 */
export const supabase: SupabaseClient = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles email-confirmation / recovery redirects
    flowType: 'pkce',
  },
  realtime: {
    params: { eventsPerSecond: 20 },
  },
});

/** App URL used to build auth redirect links (email confirmation, recovery). */
export const APP_URL: string =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin;

export const authRedirects = {
  emailConfirm: `${APP_URL}/verify`,
  passwordReset: `${APP_URL}/reset-password`,
};

/** WebRTC ICE servers, built from env. TURN is optional — see docs/LIMITATIONS.md. */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = import.meta.env.VITE_STUN_URL as string | undefined;
  if (stun) servers.push({ urls: stun });
  const turn = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turn) {
    servers.push({
      urls: turn,
      username: (import.meta.env.VITE_TURN_USERNAME as string | undefined) || undefined,
      credential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) || undefined,
    });
  }
  return servers;
}

/** True when a TURN relay is configured (voice works on restrictive networks). */
export const hasTurnRelay = Boolean(import.meta.env.VITE_TURN_URL);
