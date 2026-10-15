// File sharing: PDFs and images in the private `room-files` bucket. Object
// paths are `<room_id>/<uuid>-<name>`, and the bucket's storage policies only
// let members of that room read or write them.
import { sb } from "./supabase-client.js";
import { randomId, sanitizeFilename, fmtBytes } from "./util.js";
import { MAX_FILE_BYTES, ALLOWED_MIME } from "./config.js";

export function createFiles({ roomId, me }) {
  const BUCKET = "room-files";

  function validate(file) {
    if (!file) throw new Error("No file selected.");
    if (file.size > MAX_FILE_BYTES) throw new Error(`File is too large (${fmtBytes(file.size)}). Limit is 25 MB.`);
    if (!ALLOWED_MIME.includes(file.type)) throw new Error("Only PDF, PNG, JPG, WEBP and GIF files are allowed.");
  }

  async function list() {
    const { data, error } = await sb
      .from("documents")
      .select("id, uploader_id, storage_path, name, mime, size_bytes, page_count, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function upload(file) {
    validate(file);
    const path = `${roomId}/${randomId()}-${sanitizeFilename(file.name)}`;
    const up = await sb.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type,
    });
    if (up.error) throw up.error;

    const { data, error } = await sb
      .from("documents")
      .insert({ room_id: roomId, uploader_id: me, storage_path: path, name: file.name, mime: file.type, size_bytes: file.size })
      .select()
      .single();
    if (error) { await sb.storage.from(BUCKET).remove([path]); throw error; }
    return data;
  }

  async function signedUrl(doc, seconds = 3600) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(doc.storage_path, seconds);
    if (error) throw error;
    return data.signedUrl;
  }

  async function remove(doc) {
    const { error } = await sb.from("documents").delete().eq("id", doc.id);
    if (error) throw error;
    await sb.storage.from(BUCKET).remove([doc.storage_path]);
  }

  async function downloadBlob(doc) {
    const { data, error } = await sb.storage.from(BUCKET).download(doc.storage_path);
    if (error) throw error;
    return data;
  }

  return { list, upload, signedUrl, remove, downloadBlob, validate };
}
