import { createClient } from 'npm:@supabase/supabase-js@2';

const siteOrigin=(()=>{try{return new URL(Deno.env.get('SITE_URL')??'').origin}catch{return ''}})();
const headers={...(siteOrigin?{'Access-Control-Allow-Origin':siteOrigin}:{}),'Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==siteOrigin)return json({error:'forbidden'},403);
 const auth=req.headers.get('authorization')??'';const token=auth.replace(/^Bearer\s+/i,'');if(!token)return json({error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')??'',anon=Deno.env.get('SUPABASE_ANON_KEY')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!url||!anon||!service)return json({error:'temporarily_unavailable'},503);
 const caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:{user},error:userError}=await caller.auth.getUser(token);
 if(userError||!user)return json({error:'unauthorized'},401);
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});const form=await req.formData().catch(()=>null);
 if(!form)return json({error:'bad_request'},400);
 const action=String(form.get('action')??'');const tenantId=String(form.get('tenant_id')??'');
 if(!uuid.test(tenantId))return json({error:'bad_request'},400);
 const {data:member,error:memberError}=await admin.from('tenant_members').select('tenant_id').eq('tenant_id',tenantId).eq('user_id',user.id).eq('role','owner').maybeSingle();
 if(memberError||!member)return json({error:'forbidden'},403);
 if(action==='upload'){
  const file=form.get('file');if(!(file instanceof File)||file.size<12||file.size>5*1024*1024)return json({error:'bad_file_size'},400);
  const bytes=new Uint8Array(await file.arrayBuffer());let contentType='',ext='';
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff){contentType='image/jpeg';ext='jpg'}
  else if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a){contentType='image/png';ext='png'}
  else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){contentType='image/webp';ext='webp'}
  else return json({error:'bad_file_type'},415);
  const path=`${tenantId}/${crypto.randomUUID()}.${ext}`;
  const {error}=await admin.storage.from('tenant-media').upload(path,file,{contentType,cacheControl:'31536000',upsert:false});
  if(error)return json({error:'upload_failed'},400);
  return json({ok:true,url:admin.storage.from('tenant-media').getPublicUrl(path).data.publicUrl});
 }
 if(action==='remove'){
  const path=String(form.get('path')??'');if(!path.startsWith(`${tenantId}/`)||path.includes('..')||path.includes('\\'))return json({error:'bad_request'},400);
  const {error}=await admin.storage.from('tenant-media').remove([path]);return error?json({error:'remove_failed'},400):json({ok:true});
 }
 return json({error:'bad_request'},400);
});
