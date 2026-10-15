// =============================================================================
// StudyBoard — runtime configuration
// -----------------------------------------------------------------------------
// The publishable / anon key is DESIGNED to be public: it is shipped to every
// browser and all data access is constrained by Row Level Security. NEVER put
// the service_role key (or any database password) in this file.
//
// For local development you can instead generate js/config.js from .env — see
// README.md. The committed values below point at the StudyBoard project.
// =============================================================================

export const SUPABASE_URL = "https://pmmtzldygjhklwehzfjw.supabase.co";

// Legacy anon key (widely compatible with supabase-js v2). Public-safe.
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBtbXR6bGR5Z2poa2x3ZWh6Zmp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzA3MDUsImV4cCI6MjEwNzY0NjcwNX0.g75DoQ5l-gsZhBe_JDC-CwwK_JIDrMNW-xZmKuqdMyA";

// Modern publishable key (optional alternative to the legacy anon key above).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mpZFOYgJpjDvoyoB_DuLAw_C3fpQzHl";


// ---------------------------------------------------------------------------
// WebRTC ICE configuration.
// STUN alone handles most home/mobile networks. A restrictive (symmetric NAT /
// corporate) network needs a TURN relay. Free TURN is not reliably available,
// so add your own credentials here if you need universal connectivity.
// ---------------------------------------------------------------------------
export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// Example (commented) TURN entry — supply your own credentials:
// export const ICE_SERVERS = [
//   { urls: "stun:stun.l.google.com:19302" },
//   { urls: "turn:turn.example.com:3478", username: "user", credential: "pass" },
// ];

// ---------------------------------------------------------------------------
// Limits (kept in sync with the DB checks and the storage bucket config)
// ---------------------------------------------------------------------------
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_CHAT_LEN = 2000;
export const MAX_NICK_LEN = 32;
export const MAX_ROOM_NAME_LEN = 80;

export const APP_NAME = "StudyBoard";
export const REPO_URL = "https://github.com/your-username/studyboard";
