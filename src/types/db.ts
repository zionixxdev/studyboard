/**
 * Database types for StudyBoard.
 *
 * These mirror `supabase/migrations/*.sql`. Keep them in sync with the schema
 * (or regenerate with `supabase gen types typescript` once your project is
 * linked).
 */

export type RoomRole = 'owner' | 'moderator' | 'member';
export type MessageKind = 'text' | 'system' | 'note' | 'link';
export type ThemePref = 'dark' | 'light' | 'system';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  theme: ThemePref;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
}

export interface Room {
  id: string;
  owner_id: string;
  name: string;
  subject: string | null;
  invite_code: string;
  invite_revoked: boolean;
  created_at: string;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  role: RoomRole;
  joined_at: string;
}

/** A room row joined with the caller's membership — returned by the list RPC. */
export interface RoomSummary extends Room {
  my_role: RoomRole;
  member_count: number;
}

export interface Message {
  id: number;
  room_id: string;
  user_id: string;
  body: string;
  kind: MessageKind;
  created_at: string;
  /** Denormalised for display; populated by the message query join. */
  display_name?: string;
}

export interface WhiteboardSnapshot {
  room_id: string;
  data: unknown; // opaque scene document; see Whiteboard.tsx for the shape
  updated_at: string;
  updated_by: string;
}

export interface StudyFile {
  id: string;
  room_id: string;
  uploader_id: string;
  storage_path: string;
  name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
}

/** Shared, server-authoritative room state: current PDF and timer. */
export interface RoomState {
  room_id: string;
  pdf_file_id: string | null;
  pdf_page: number;
  /** { mode, durationSec, startedAt, pausedAt, running } — see TimerPanel. */
  timer: TimerState;
  updated_at: string;
}

export interface TimerState {
  mode: 'pomodoro' | 'custom';
  durationSec: number;
  /** Server ISO timestamp when the current run began (null if not running). */
  startedAt: string | null;
  /** Milliseconds already elapsed in prior runs of this session. */
  elapsedMs: number;
  running: boolean;
}

/** Realtime broadcast payloads (channel: `room:<id>`). */
export type RealtimeEvent =
  | { type: 'whiteboard:op'; op: WhiteboardOp; sender: string }
  | { type: 'whiteboard:snapshot'; data: unknown; sender: string }
  | { type: 'cursor'; x: number; y: number; sender: string }
  | { type: 'pdf:sync'; fileId: string | null; page: number; sender: string }
  | { type: 'timer:sync'; timer: TimerState; sender: string }
  | { type: 'chat:new'; message: Message }
  | { type: 'presence'; userId: string; name: string; state: 'join' | 'leave' };

/** A single drawing operation, broadcast incrementally (never the whole canvas). */
export type WhiteboardOp =
  | { kind: 'stroke'; tool: 'pen' | 'highlighter' | 'eraser'; color: string; width: number; points: [number, number][] }
  | { kind: 'shape'; shape: 'rect' | 'ellipse' | 'line' | 'arrow'; color: string; width: number; from: [number, number]; to: [number, number] }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { kind: 'formula'; x: number; y: number; latex: string }
  /** An image placed on the board. `path` is its object path in the private
   *  `room-files` bucket — the bitmap itself is never sent over the wire. */
  | { kind: 'image'; x: number; y: number; width: number; height: number; path: string }
  | { kind: 'clear' };
