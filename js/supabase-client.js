// Single shared Supabase client. supabase-js is loaded from a CDN as an ES
// module so the repo needs no build step; the service worker caches it for
// offline/instant repeat loads.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // survives refresh via localStorage
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 20 }, // throttle: protects slow connections
  },
  global: { headers: { "x-application-name": "studyboard" } },
});
