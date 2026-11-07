import { createClient } from 'npm:@supabase/supabase-js@2';

const site=(Deno.env.get('SITE_URL')??'').trim();
const allowed=new Set<string>(); try{if(site)allowed.add(new URL(site).origin)}catch{}
allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173');
const headers=(req:Request)=>{const origin=req.headers.get('origin')??'';return {'Access-Control-Allow-Origin':allowed.has(origin)?origin:'null','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}};
const json=(req:Request,value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:headers(req)});
const emailOk=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:headers(req)});
 if(req.method!=='POST')return json(req,{error:'method_not_allowed'},405);
 const origin=req.headers.get('origin'); if(origin&&!allowed.has(origin))return json(req,{error:'forbidden'},403);
 const bearer=req.headers.get('authorization')??''; const token=bearer.replace(/^Bearer\s+/i,'');
 if(!token)return json(req,{error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')??'', anon=Deno.env.get('SUPABASE_ANON_KEY')??'', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!url||!anon||!service)return json(req,{error:'temporarily_unavailable'},503);
 const caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}); const {data:{user},error:authError}=await caller.auth.getUser(token);
 if(authError||!user)return json(req,{error:'unauthorized'},401);
 const p=await req.json().catch(()=>null) as Record<string,unknown>|null;
 const slug=typeof p?.slug==='string'?p.slug:''; const action=typeof p?.action==='string'?p.action:'';
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:can,error:canErr}=await admin.rpc('owner_team_can_manage',{p_slug:slug,p_actor:user.id});
 if(canErr||can!==true)return json(req,{error:'forbidden'},403);
 if(action==='list'){
  const {data,error}=await admin.rpc('owner_team_list',{p_slug:slug,p_actor:user.id});
  return error?json(req,{error:'operation_failed'},400):json(req,{members:data??[]});
 }
 if(action==='remove'){
  const id=typeof p?.user_id==='string'?p.user_id:''; const {error}=await admin.rpc('owner_team_remove',{p_slug:slug,p_actor:user.id,p_user:id});
  return error?json(req,{error:error.message==='owner_protected'?'owner_protected':'operation_failed'},400):json(req,{ok:true});
 }
 if(action==='set_role'){
  const id=typeof p?.user_id==='string'?p.user_id:''; const role=p?.role; const resource=typeof p?.resource_id==='string'?p.resource_id:null;
  const {error}=await admin.rpc('owner_team_set',{p_slug:slug,p_actor:user.id,p_user:id,p_role:role,p_resource:resource});
  return error?json(req,{error:'operation_failed'},400):json(req,{ok:true});
 }
 if(action!=='create')return json(req,{error:'bad_request'},400);
 const email=typeof p?.email==='string'?p.email.trim().toLowerCase():''; const role=p?.role; const resource=typeof p?.resource_id==='string'?p.resource_id:null;
 if(!emailOk(email)||!['manager','staff'].includes(String(role)))return json(req,{error:'bad_request'},400);
 // A staff member must have a work post; managers are not restricted to one.
 if(role==='staff'&&!resource)return json(req,{error:'bad_resource'},400);
 let foundUser: {id:string}|null=null;
 for(let page=1;page<=20&&!foundUser;page++){
  const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000}); if(error)return json(req,{error:'temporarily_unavailable'},503);
  foundUser=data.users.find(x=>x.email?.toLowerCase()===email)??null; if(data.users.length<1000)break;
 }
 let temporaryPassword:string|null=null; let userId=foundUser?.id??'';
 if(!foundUser){
  temporaryPassword=`K${Array.from(crypto.getRandomValues(new Uint8Array(20)),x=>(x%36).toString(36)).join('')}!a9`;
  const {data,error}=await admin.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true,user_metadata:{must_change_password:true}});
  if(error)return json(req,{error:error.message.toLowerCase().includes('already')?'email_exists':'create_failed'},400);
  userId=data.user.id;
 }
 const {error}=await admin.rpc('owner_team_set',{p_slug:slug,p_actor:user.id,p_user:userId,p_role:role,p_resource:resource});
 if(error)return json(req,{error:'operation_failed'},400);
 return json(req,{ok:true,created:!foundUser,temporary_password:temporaryPassword});
});
