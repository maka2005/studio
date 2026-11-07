import { supabase } from './supabase';
const BUCKET = 'tenant-media';
// Сжимаем в браузере: ограничиваем сторону и перекодируем (заодно убирается лишняя метаинформация).
export async function prepareImage(file: File, maxSide: number, type: 'image/jpeg' | 'image/png'): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Допустимы файлы JPG, PNG или WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ.');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d'); if (!ctx) throw new Error('Не удалось обработать изображение.');
  ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.85));
  if (!blob) throw new Error('Не удалось обработать изображение.');
  if (blob.size > 5 * 1024 * 1024) throw new Error('После сжатия файл всё ещё больше 5 МБ.');
  return blob;
}
export async function uploadImage(tenantId: string, blob: Blob, ext: 'jpg' | 'png'): Promise<string> {
  const form=new FormData();form.set('action','upload');form.set('tenant_id',tenantId);form.set('file',new File([blob],`upload.${ext}`,{type:blob.type}));
  const {data,error}=await supabase.functions.invoke('media-management',{body:form});
  if(error)throw error;if(typeof data?.url!=='string')throw new Error('Не удалось загрузить изображение.');return data.url;
}
export async function removeByUrl(url: string) {   // ссылки не из хранилища (файлы из tenants/) пропускаются
  const part = url.split(`/object/public/${BUCKET}/`)[1]; if (!part) return;
  const path=decodeURIComponent(part);const tenantId=path.split('/')[0];if(!tenantId)return;
  const form=new FormData();form.set('action','remove');form.set('tenant_id',tenantId);form.set('path',path);
  const {error}=await supabase.functions.invoke('media-management',{body:form});if(error)throw error;
}
