import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { Spinner } from '@/components/ui/Spinner';
import { supabase } from '@/lib/supabase';
import type { RealtimeEvent, StudyFile } from '@/types/db';
import type { useRoomRealtime } from '@/hooks/useRoomRealtime';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const BUCKET = 'room-files';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export default function PdfPanel({
  roomId,
  realtime,
  meId,
  canManage,
}: {
  roomId: string;
  realtime: ReturnType<typeof useRoomRealtime>;
  meId: string;
  canManage: boolean;
}) {
  const [files, setFiles] = useState<StudyFile[]>([]);
  const [active, setActive] = useState<StudyFile | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.2);
  const [uploading, setUploading] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const loadFiles = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('files')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setFiles((data as StudyFile[]) ?? []);
  }, [roomId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  /** Delete an upload — the storage object and its row. Only the uploader or a
   *  room owner/moderator may do this; the database enforces it too. */
  async function remove(file: StudyFile) {
    if (!window.confirm(`Delete "${file.name}" for everyone?`)) return;
    setDeletingId(file.id);
    setError(null);
    try {
      const { error: stErr } = await supabase.storage.from(BUCKET).remove([file.storage_path]);
      if (stErr) throw stErr;
      const { error: dbErr } = await supabase.from('files').delete().eq('id', file.id);
      if (dbErr) throw dbErr;
      if (active?.id === file.id) {
        setActive(null);
        setDoc(null);
      }
      await loadFiles();
    } catch (e) {
      setError(`Could not delete: ${(e as Error).message}`);
    } finally {
      setDeletingId(null);
    }
  }

  // Open a PDF: create a short-lived signed URL for the private object, then
  // hand it to pdf.js.
  const open = useCallback(async (file: StudyFile) => {
    setError(null);
    setLoadingDoc(true);
    setActive(file);
    try {
      const { data, error: err } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(file.storage_path, 3600);
      if (err) throw err;
      const loaded = await pdfjs.getDocument({ url: data.signedUrl }).promise;
      setDoc(loaded);
      setNumPages(loaded.numPages);
      setPage(1);
    } catch (e) {
      setError(`Could not open PDF: ${(e as Error).message}`);
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  // Render the current page.
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom * Math.min(window.devicePixelRatio || 1, 2) });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / Math.min(window.devicePixelRatio || 1, 2)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        /* render cancelled — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom]);

  // Follow page changes broadcast by others.
  useEffect(() => {
    return realtime.subscribe((e: RealtimeEvent) => {
      if (e.type === 'pdf:sync' && active && e.fileId === active.id) {
        setPage(e.page);
      }
    });
  }, [realtime, active]);

  function gotoPage(next: number) {
    const clamped = Math.max(1, Math.min(numPages || 1, next));
    setPage(clamped);
    if (active) {
      realtime.broadcast({ type: 'pdf:sync', fileId: active.id, page: clamped, sender: '' });
    }
  }

  async function upload(file: File) {
    setError(null);
    setStatus(null);

    if (file.type !== 'application/pdf') {
      return setError('Only PDF files are allowed.');
    }
    if (file.size > MAX_BYTES) {
      return setError('PDF is larger than the 25 MB limit.');
    }

    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const path = `${roomId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from('files').insert({
        room_id: roomId,
        uploader_id: auth.user?.id,
        storage_path: path,
        name: file.name,
        mime: file.type,
        size_bytes: file.size,
      });
      if (dbErr) throw dbErr;

      setStatus('Uploaded.');
      await loadFiles();
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* File list + upload */}
      <GlassCard className="p-4">
        <h3 className="mb-3 font-semibold text-ink">Files</h3>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <GlassButton
          block
          loading={uploading}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </GlassButton>
        <p className="mt-2 text-xs text-faint">
          PDF only, up to 25 MB. Images added on the whiteboard appear here too.
        </p>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        {status && <p className="mt-3 text-xs text-success">{status}</p>}

        <ul className="mt-4 space-y-1.5">
          {files.length === 0 && <li className="text-sm text-faint">No files yet.</li>}
          {files.map((f) => {
            const isPdf = f.mime === 'application/pdf';
            const canDelete = f.uploader_id === meId || canManage;
            return (
              <li key={f.id} className="flex items-start gap-1.5">
                <button
                  onClick={() => isPdf && void open(f)}
                  disabled={!isPdf}
                  title={isPdf ? 'Open' : 'Images are annotated on the whiteboard'}
                  className={
                    'focus-ring min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm ' +
                    (active?.id === f.id
                      ? 'bg-accent/20 text-ink'
                      : 'glass-subtle text-soft hover:text-ink') +
                    (isPdf ? '' : ' cursor-default')
                  }
                >
                  <span className="block truncate">{f.name}</span>
                  <span className="text-xs text-faint">
                    {isPdf ? 'PDF' : 'Image'} · {(f.size_bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </button>
                {canDelete && (
                  <button
                    onClick={() => void remove(f)}
                    disabled={deletingId === f.id}
                    aria-label={`Delete ${f.name}`}
                    title="Delete"
                    className="focus-ring pill shrink-0 px-2 py-2 text-xs text-danger hover:bg-danger/15 disabled:opacity-50"
                  >
                    {deletingId === f.id ? '…' : 'Delete'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </GlassCard>

      {/* Viewer */}
      <GlassCard className="flex flex-col p-4">
        {!active ? (
          <div className="grid min-h-[50vh] place-items-center text-sm text-faint">
            Select a PDF to view, or upload one.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="truncate text-sm text-soft">{active.name}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <GlassButton size="sm" variant="subtle" onClick={() => gotoPage(page - 1)}>
                  ‹ Prev
                </GlassButton>
                <span className="px-2 text-sm text-soft">
                  {page} / {numPages || '…'}
                </span>
                <GlassButton size="sm" variant="subtle" onClick={() => gotoPage(page + 1)}>
                  Next ›
                </GlassButton>
                <GlassButton size="sm" variant="subtle" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
                  −
                </GlassButton>
                <GlassButton size="sm" variant="subtle" onClick={() => setZoom((z) => Math.min(4, z + 0.2))}>
                  +
                </GlassButton>
              </div>
            </div>

            <div className="min-h-[55vh] overflow-auto rounded-2xl glass-subtle p-3">
              {loadingDoc ? (
                <div className="flex items-center gap-2 text-sm text-soft">
                  <Spinner size={16} /> Loading PDF…
                </div>
              ) : (
                <canvas ref={canvasRef} className="mx-auto block" />
              )}
            </div>
            <p className="mt-2 text-xs text-faint">
              Page changes sync to everyone in the room.
            </p>
          </>
        )}
      </GlassCard>
    </div>
  );
}
