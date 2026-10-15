// Copy to js/config.js (or generate it with `node scripts/gen-config.mjs`).
// The publishable / anon key is designed to be public — RLS protects the data.
// NEVER place the service_role key here.

export const SUPABASE_URL = "https://your-project-ref.supabase.co";
export const SUPABASE_ANON_KEY = "your-anon-or-publishable-key";

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = [
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
];
export const MAX_CHAT_LEN = 2000;
export const MAX_NICK_LEN = 32;
export const MAX_ROOM_NAME_LEN = 80;

export const APP_NAME = "StudyBoard";
export const REPO_URL = "https://github.com/your-username/studyboard";
