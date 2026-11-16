import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image } from 'npm:imagescript@1.3.1';

const siteOrigin = (() => { try { return new URL(Deno.env.get('SITE_URL') ?? '').origin; } catch { return ''; } })();
const headers = { ...(siteOrigin ? { 'Access-Control-Allow-Origin': siteOrigin } : {}), 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

type ImgKind = { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };
function detect(bytes: Uint8Array): ImgKind | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { contentType: 'image/png', ext: 'png' };
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { contentType: 'image/webp', ext: 'webp' };
  return null;
}

async function optimizeImage(bytes: Uint8Array, kind: ImgKind): Promise<{ bytes: Uint8Array; contentType: string; ext: string }> {
  try {
    const decoded = await Image.decode(bytes);
    const width = decoded.width;
    const height = decoded.height;
    if (!width || !height) return { bytes, contentType: kind.contentType, ext: kind.ext };
    let image = decoded;
    const maxSide = Math.max(width, height);
    if (maxSide > MAX_DIMENSION) {
      if (width >= height) image = image.resize(MAX_DIMENSION, Image.RESIZE_AUTO);
      else image = image.resize(Image.RESIZE_AUTO, MAX_DIMENSION);
    }
    // For photos prefer JPEG output to reduce size; keep PNG if it has alpha-like transparency risk is low for studio photos.
    if (kind.contentType === 'image/png') {
      const out = await image.encodePNG();
      return { bytes: new Uint8Array(out), contentType: 'image/png', ext: 'png' };
    }
    if (kind.contentType === 'image/webp') {
      // imagescript encodes JPEG/PNG reliably; convert webp to optimized jpeg unless very small.
      const out = await image.encodeJPEG(JPEG_QUALITY);
      return { bytes: new Uint8Array(out), contentType: 'image/jpeg', ext: 'jpg' };
    }
    const out = await image.encodeJPEG(JPEG_QUALITY);
    return { bytes: new Uint8Array(out), contentType: 'image/jpeg', ext: 'jpg' };
  } catch (error) {
    console.warn('media resize skipped:', (error as Error)?.message || error);
    return { bytes, contentType: kind.contentType, ext: kind.ext };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const origin = req.headers.get('origin'); if (origin && origin !== siteOrigin) return json({ error: 'forbidden' }, 403);
  const auth = req.headers.get('authorization') ?? ''; const token = auth.replace(/^Bearer\s+/i, ''); if (!token) return json({ error: 'unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL') ?? '', anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json({ error: 'temporarily_unavailable' }, 503);
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }); const { data: { user }, error: userError } = await caller.auth.getUser(token);
  if (userError || !user) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }); const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad_request' }, 400);
  const action = String(form.get('action') ?? ''); const tenantId = String(form.get('tenant_id') ?? '');
  if (!uuid.test(tenantId)) return json({ error: 'bad_request' }, 400);
  const { data: member, error: memberError } = await admin.from('tenant_members').select('tenant_id').eq('tenant_id', tenantId).eq('user_id', user.id).eq('role', 'owner').maybeSingle();
  if (memberError || !member) return json({ error: 'forbidden' }, 403);
  if (action === 'upload') {
    const file = form.get('file'); if (!(file instanceof File) || file.size < 12 || file.size > 5 * 1024 * 1024) return json({ error: 'bad_file_size' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = detect(bytes);
    if (!kind) return json({ error: 'bad_file_type' }, 415);
    const optimized = await optimizeImage(bytes, kind);
    const path = `${tenantId}/${crypto.randomUUID()}.${optimized.ext}`;
    const { error } = await admin.storage.from('tenant-media').upload(path, optimized.bytes, { contentType: optimized.contentType, cacheControl: '31536000', upsert: false });
    if (error) return json({ error: 'upload_failed' }, 400);
    return json({ ok: true, url: admin.storage.from('tenant-media').getPublicUrl(path).data.publicUrl });
  }
  if (action === 'remove') {
    const path = String(form.get('path') ?? ''); if (!path.startsWith(`${tenantId}/`) || path.includes('..') || path.includes('\\')) return json({ error: 'bad_request' }, 400);
    const { error } = await admin.storage.from('tenant-media').remove([path]); return error ? json({ error: 'remove_failed' }, 400) : json({ ok: true });
  }
  return json({ error: 'bad_request' }, 400);
});
