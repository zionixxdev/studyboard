import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names and de-duplicate conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Basic, non-authoritative email shape check for client-side UX only.
 *  Real validation happens in Supabase Auth and in the SQL layer. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export interface PasswordCheck {
  ok: boolean;
  score: number; // 0..4
  problems: string[];
}

/** Client-side password strength guidance. The server enforces its own rules. */
export function checkPassword(pw: string): PasswordCheck {
  const problems: string[] = [];
  if (pw.length < 8) problems.push('Use at least 8 characters.');
  if (!/[A-Za-z]/.test(pw)) problems.push('Include at least one letter.');
  if (!/[0-9]/.test(pw)) problems.push('Include at least one number.');
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { ok: problems.length === 0, score, problems };
}

/** Format an ISO timestamp as a short local time (used in chat). */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Format a duration in seconds as mm:ss (or h:mm:ss). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Cryptographically-random short code (default 8 chars, no ambiguous glyphs). */
export function randomCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Initials for an avatar fallback. */
export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
