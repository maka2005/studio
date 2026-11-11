import { createClient } from 'npm:@supabase/supabase-js@2';

// Единственная точка входа админки платформы. Правила:
//  - JWT проверяется на сервере (auth.getUser), затем наличие user_id в platform_admins;
//  - SUPABASE_SERVICE_ROLE_KEY используется только здесь, в браузер не попадает;
//  - если PLATFORM_REQUIRE_MFA=true, токен обязан иметь aal2 (TOTP подтверждён);
//  - критичные операции требуют idempotency_key, повтор возвращает прежний результат.

const site = (Deno.env.get('SITE_URL') ?? '').trim();
const allowed = new Set<string>();
try { if (site) allowed.add(new URL(site).origin); } catch { /* configured by deployment */ }
try { if (['localhost', '127.0.0.1'].includes(new URL(Deno.env.get('SUPABASE_URL') ?? '').hostname)) { allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173'); } } catch { /* prod: SITE_URL only */ }
const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  return allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : { 'Vary': 'Origin' };
};
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsFor(req), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

const aalOf = (token: string): string => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return String(payload.aal ?? 'aal1');
  } catch { return 'aal1'; }
};

const ERROR_STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, slug_taken: 409, subscription_exists: 409, idempotency_conflict: 409,
  bad_status: 409, no_paid_payment: 409, unlimited_subscription: 409, bad_request:400,
  plan_limit_employees: 409, plan_limit_services: 409, plan_limit_bookings_per_month: 409, trial_already_used:409,
};
const KNOWN = [
  'forbidden', 'not_found', 'slug_taken', 'bad_slug', 'bad_name', 'bad_timezone', 'owner_missing', 'plan_not_found', 'bad_duration',
  'bad_dates', 'bad_status', 'bad_action', 'bad_setting', 'bad_value', 'reason_required', 'subscription_exists', 'idempotency_conflict',
  'no_paid_payment', 'unlimited_subscription', 'bad_limits', 'bad_features',
  'plan_limit_employees', 'plan_limit_services', 'plan_limit_bookings_per_month','trial_already_used','trial_identity_required',
];

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsFor(req), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const origin = req.headers.get('origin');
  if (origin && !allowed.has(origin)) return json(req, { error: 'forbidden' }, 403);

  const url = Deno.env.get('SUPABASE_URL') ?? '', anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '', service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !service) return json(req, { error: 'temporarily_unavailable' }, 503);
  const body = obj(await req.json().catch(() => null));
  const action = str(body.action, 40);
  if (!action) return json(req, { error: 'bad_request' }, 400);

  // --- 1. аутентификация
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'unauthorized' }, 401);
  const caller = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await caller.auth.getUser(token);
  if (authError || !user) return json(req, { error: 'unauthorized' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- 2. первоначальная настройка: первый суперадмин (только пока таблица пуста и email совпал)
  if (action === 'bootstrap') {
    const expected = (Deno.env.get('PLATFORM_SUPERADMIN_EMAIL') ?? '').trim().toLowerCase();
    if (!expected || user.email?.toLowerCase() !== expected) return json(req, { error: 'forbidden' }, 403);
    const { count, error } = await admin.from('platform_admins').select('user_id', { count: 'exact', head: true });
    if (error) return json(req, { error: 'operation_failed' }, 500);
    if ((count ?? 0) > 0) return json(req, { error: 'forbidden' }, 403);
    const { error: insertError } = await admin.from('platform_admins').insert({ user_id: user.id, role: 'owner', is_active: true });
    if (insertError) return json(req, { error: 'operation_failed' }, 500);
    await admin.rpc('platform_log', { p_actor: user.id, p_action: 'platform.bootstrap', p_tenant: null, p_payload: {} });
    return json(req, { ok: true });
  }

  // Configured platform owner can restore the owner role after a mistaken role change.
  if (action === 'recover_owner') {
    const expected = (Deno.env.get('PLATFORM_SUPERADMIN_EMAIL') ?? '').trim().toLowerCase();
    if (!expected || user.email?.toLowerCase() !== expected) return json(req, { error: 'forbidden' }, 403);
    const { error } = await admin.from('platform_admins').upsert({ user_id: user.id, role: 'owner', is_active: true });
    if (error) return json(req, { error: 'operation_failed' }, 500);
    await admin.rpc('platform_log', { p_actor: user.id, p_action: 'admin.owner_recovery', p_tenant: null, p_payload: { email: user.email } });
    return json(req, { ok: true });
  }

  // --- 3. роль проверяется на сервере по таблице platform_admins
  const { data: adminRow, error: roleError } = await admin.from('platform_admins').select('role,is_active').eq('user_id', user.id).maybeSingle();
  if (roleError) return json(req, { error: 'temporarily_unavailable' }, 503);
  if (!adminRow?.is_active) return json(req, { error: 'forbidden' }, 403);
  const role = String(adminRow.role ?? 'owner');
  const mfaNeeded = Deno.env.get('PLATFORM_REQUIRE_MFA') === 'true' && aalOf(token) !== 'aal2';
  if (action === 'whoami') return json(req, { ok: true, email: user.email, role, aal: aalOf(token), mfa_required: mfaNeeded });
  if (mfaNeeded) return json(req, { error: 'mfa_required' }, 403);

  const readActions = new Set(['whoami','dashboard','tenants','tenant','tenant_events','subscriptions','plans','payments','audit','notifications','settings','admins']);
  const financeActions = new Set(['payments','payment_create','payment_confirm','payment_refund','payment_fail','subscriptions','dashboard','audit','notifications','tenants','tenant','tenant_events','plans']);
  const supportActions = new Set(['tenants','tenant','tenant_events','resend_invite','impersonation_start','impersonation_check','impersonation_end','impersonation_log']);
  const allowedByRole = role === 'owner' ? null : role === 'read_only' ? readActions : role === 'finance' ? financeActions : supportActions;
  if (!['owner','support','finance','read_only'].includes(role) || (allowedByRole && !allowedByRole.has(action)))
    return json(req, { error: 'forbidden' }, 403);

  // --- 4. лимиты запросов
  const actor = user.id;
  const rate = await admin.rpc('consume_platform_rate', { p_scope: 'platform_admin', p_key: `actor:${actor}`, p_limit: 240, p_window: 60 });
  if (rate.error) return json(req, { error: 'temporarily_unavailable' }, 503);
  if (rate.data !== true) return json(req, { error: 'rate_limited' }, 429);

  const idem = str(body.idempotency_key, 128);
  const needKey = () => KEY.test(idem);
  const uuidOf = (v: unknown) => { const s = str(v, 40); return UUID.test(s) ? s : null; };

  try {
    if (action === 'impersonation_start') {
      const tenantId = uuidOf(body.tenant_id);
      const reason = str(body.reason, 500);
      if (!tenantId || reason.length < 5) return json(req, { error: 'reason_required' }, 400);
      const { data: tenant } = await admin.from('tenants').select('id,slug,config').eq('id', tenantId).maybeSingle();
      if (!tenant) return json(req, { error: 'not_found' }, 404);
      const { data: member } = await admin.from('tenant_members').select('user_id').eq('tenant_id', tenantId).eq('role','owner').limit(1).maybeSingle();
      if (!member) return json(req, { error: 'owner_missing' }, 404);
      const { data: ownerResult, error: ownerError } = await admin.auth.admin.getUserById(member.user_id);
      if (ownerError || !ownerResult.user?.email) return json(req, { error: 'owner_missing' }, 404);
      const now = new Date(); const expiresAt = new Date(now.getTime() + 30 * 60_000);
      const { data: sessionRow, error: insertError } = await admin.from('platform_impersonation_sessions').insert({ actor_id: actor, tenant_id: tenantId, reason, expires_at: expiresAt.toISOString() }).select('id').single();
      if (insertError || !sessionRow) return json(req, { error: 'operation_failed' }, 500);
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ownerResult.user.email });
      if (linkError || !link.properties?.hashed_token) {
        await admin.from('platform_impersonation_sessions').update({ ended_at: new Date().toISOString() }).eq('id',sessionRow.id);
        return json(req, { error: 'operation_failed' }, 502);
      }
      const { data: ownerSession, error: verifyError } = await caller.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
      if (verifyError || !ownerSession.session) {
        await admin.from('platform_impersonation_sessions').update({ ended_at: new Date().toISOString() }).eq('id',sessionRow.id);
        return json(req, { error: 'operation_failed' }, 502);
      }
      await admin.rpc('platform_log', { p_actor: actor, p_action: 'impersonation.start', p_tenant: tenantId, p_payload: { session_id: sessionRow.id, reason, expires_at: expiresAt.toISOString(), owner_email: ownerResult.user.email } });
      await admin.from('admin_audit_events').insert({ tenant_id:tenantId,actor_id:actor,entity:'support',entity_id:sessionRow.id,action:'support_started',details:{reason,expires_at:expiresAt.toISOString()} });
      return json(req, { ok: true, data: { session_id: sessionRow.id, tenant_id: tenantId, tenant_slug: tenant.slug, tenant_name: obj(tenant.config).name, reason, expires_at: expiresAt.toISOString(), owner_session: ownerSession.session } });
    }
    if (action === 'impersonation_check' || action === 'impersonation_end' || action === 'impersonation_log') {
      const sessionId = uuidOf(body.session_id);
      if (!sessionId) return json(req, { error: 'bad_request' }, 400);
      const { data: active } = await admin.from('platform_impersonation_sessions').select('id,tenant_id,reason,expires_at,ended_at,tenants(slug,config)').eq('id',sessionId).eq('actor_id',actor).maybeSingle();
      if (!active || active.ended_at) return json(req, { error: 'impersonation_expired' }, 401);
      if (new Date(active.expires_at).getTime() <= Date.now()) {
        const endedAt=new Date().toISOString();
        await admin.from('platform_impersonation_sessions').update({ended_at:endedAt}).eq('id',sessionId).is('ended_at',null);
        await admin.rpc('platform_log',{p_actor:actor,p_action:'impersonation.expired',p_tenant:active.tenant_id,p_payload:{session_id:sessionId}});
        await admin.from('admin_audit_events').insert({tenant_id:active.tenant_id,actor_id:actor,entity:'support',entity_id:sessionId,action:'support_expired',details:{}});
        return json(req, { error: 'impersonation_expired' }, 401);
      }
      if (action === 'impersonation_end') {
        const endedAt = new Date().toISOString();
        await admin.from('platform_impersonation_sessions').update({ ended_at: endedAt }).eq('id',sessionId);
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'impersonation.end', p_tenant: active.tenant_id, p_payload: { session_id: sessionId } });
        await admin.from('admin_audit_events').insert({ tenant_id:active.tenant_id,actor_id:actor,entity:'support',entity_id:sessionId,action:'support_ended',details:{} });
        return json(req, { ok: true });
      }
      if (action === 'impersonation_log') {
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'impersonation.action', p_tenant: active.tenant_id, p_payload: { session_id: sessionId, action: str(body.owner_action, 80), succeeded: body.succeeded === true } });
        const ownerAction=str(body.owner_action,80);
        const mutations=new Set(['owner_set_status','staff_set_status','owner_cancel','owner_erase_customer','owner_reschedule','owner_create_booking','owner_block','owner_add_payment','owner_upsert_service','owner_delete_service','owner_upsert_resource','owner_delete_resource','owner_update_notification_settings','owner_update_config','owner_update_legal','owner_telegram_unlink','owner_waitlist_status','owner_upsert_promo','owner_delete_promo','owner_publish_review','owner_respond_price_change']);
        if(mutations.has(ownerAction)) await admin.from('admin_audit_events').insert({tenant_id:active.tenant_id,actor_id:actor,entity:'support',entity_id:sessionId,action:'support_action',details:{owner_action:ownerAction,succeeded:body.succeeded===true}});
      }
      const tenantValue = Array.isArray(active.tenants) ? active.tenants[0] : active.tenants;
      return json(req, { ok: true, data: { tenant_id: active.tenant_id, tenant_slug: tenantValue?.slug, tenant_name: obj(tenantValue?.config).name, reason: active.reason, expires_at: active.expires_at } });
    }
    if (action === 'admins') {
      if (role !== 'owner') return json(req, { error: 'forbidden' }, 403);
      const { data: rows, error } = await admin.from('platform_admins').select('user_id,role,is_active,created_at').order('created_at', { ascending: true });
      if (error) return json(req, { error: 'operation_failed' }, 500);
      const data = await Promise.all((rows ?? []).map(async (row) => {
        const result = await admin.auth.admin.getUserById(row.user_id);
        return { ...row, email: result.data.user?.email ?? '' };
      }));
      return json(req, { ok: true, data });
    }
    if (action === 'admin_add' || action === 'admin_update' || action === 'admin_disable' || action === 'admin_reset_mfa') {
      if (role !== 'owner') return json(req, { error: 'forbidden' }, 403);
      const targetId = str(body.user_id, 40);
      const targetRole = str(body.role, 20);
      if (action === 'admin_add') {
        const email = str(body.email, 254).toLowerCase();
        if (!EMAIL.test(email) || !['support','finance','read_only','owner'].includes(targetRole)) return json(req, { error: 'bad_request' }, 400);
        let target = await findUserByEmail(admin, email);
        let created = false;
        if (!target) {
          const result = await admin.auth.admin.createUser({ email, email_confirm: true });
          if (result.error || !result.data.user) return json(req, { error: 'operation_failed' }, 502);
          target = result.data.user; created = true;
        }
        const { error } = await admin.from('platform_admins').upsert({ user_id: target.id, role: targetRole, is_active: true });
        if (error) return json(req, { error: 'operation_failed' }, 500);
        const inviteSent = created && !!site && !(await caller.auth.resetPasswordForEmail(email, { redirectTo: `${site.replace(/\/$/, '')}/platform/admin` })).error;
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'admin.add', p_tenant: null, p_payload: { target_user_id: target.id, target_email: email, role: targetRole, created, invite_sent: inviteSent } });
        return json(req, { ok: true, created, invite_sent: inviteSent });
      }
      if (!UUID.test(targetId) || targetId === actor) return json(req, { error: 'bad_request' }, 400);
      const targetUser = await admin.auth.admin.getUserById(targetId);
      const targetEmail = targetUser.data.user?.email ?? '';
      if (action === 'admin_update') {
        if (!['owner','support','finance','read_only'].includes(targetRole)) return json(req, { error: 'bad_request' }, 400);
        const { error } = await admin.from('platform_admins').update({ role: targetRole }).eq('user_id', targetId);
        if (error) return json(req, { error: 'operation_failed' }, 500);
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'admin.role_update', p_tenant: null, p_payload: { target_user_id: targetId, target_email: targetEmail, role: targetRole } });
      } else if (action === 'admin_disable') {
        const { error } = await admin.from('platform_admins').update({ is_active: false }).eq('user_id', targetId);
        if (error) return json(req, { error: 'operation_failed' }, 500);
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'admin.disable', p_tenant: null, p_payload: { target_user_id: targetId, target_email: targetEmail } });
      } else {
        const { data: factors, error: factorsError } = await admin.auth.admin.mfa.listFactors({ userId: targetId });
        if (factorsError) return json(req, { error: 'operation_failed' }, 500);
        for (const factor of factors.factors) {
          const { error } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: targetId });
          if (error) return json(req, { error: 'operation_failed' }, 500);
        }
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'admin.mfa_reset', p_tenant: null, p_payload: { target_user_id: targetId, target_email: targetEmail, factors_removed: factors.factors.length } });
      }
      return json(req, { ok: true });
    }
    let rpc: { name: string; args: Record<string, unknown> } | null = null;
    switch (action) {
      case 'dashboard': rpc = { name: 'platform_dashboard', args: { p_actor: actor } }; break;
      case 'tenants': rpc = { name: 'platform_list_tenants', args: { p_actor: actor, p_search: str(body.search, 80) || null, p_phase: str(body.phase, 20) || null, p_plan: str(body.plan, 20) || null, p_limit: Number(body.limit) || 50, p_offset: Number(body.offset) || 0 } }; break;
      case 'tenant': { const id = uuidOf(body.tenant_id); if (!id) return json(req, { error: 'bad_request' }, 400); rpc = { name: 'platform_tenant_card', args: { p_actor: actor, p_tenant: id } }; break; }
      case 'tenant_events': { const id = uuidOf(body.tenant_id); if (!id) return json(req, { error: 'bad_request' }, 400); rpc = { name: 'platform_tenant_events', args: { p_actor: actor, p_tenant: id, p_limit: Number(body.limit) || 50, p_offset: Math.max(0, Number(body.offset) || 0) } }; break; }
      case 'tenant_limits_set': {
        const id=uuidOf(body.tenant_id); if(!id||role!=='owner')return json(req,{error:'forbidden'},403);
        rpc={name:'platform_set_tenant_plan_override',args:{p_actor:actor,p_tenant:id,p_limits:obj(body.limits),p_features:obj(body.features),p_reason:str(body.reason,500)}}; break;
      }
      case 'tenant_lifecycle': {
        const id=uuidOf(body.tenant_id), action=str(body.lifecycle_action,30), reason=str(body.reason,500);
        if(!id||role!=='owner'||reason.length<5)return json(req,{error:'forbidden'},403);
        rpc={name:'platform_tenant_lifecycle',args:{p_actor:actor,p_tenant:id,p_action:action,p_reason:reason}};break;
      }
      case 'billing_documents': rpc={name:'platform_billing_documents_list',args:{p_actor:actor,p_tenant:uuidOf(body.tenant_id)}};break;
      case 'billing_document_save': rpc={name:'platform_billing_document_save',args:{p_actor:actor,p:obj(body.document)}};break;
      case 'subscriptions': rpc = { name: 'platform_list_subscriptions', args: { p_actor: actor, p_phase: str(body.phase, 20) || null, p_limit: Number(body.limit) || 100 } }; break;
      case 'plans': rpc = { name: 'platform_list_plans', args: { p_actor: actor } }; break;
      case 'plan_save': rpc = { name: 'platform_upsert_plan', args: { p_actor: actor, p: obj(body.plan) } }; break;
      case 'payments': rpc = { name: 'platform_list_payments', args: { p_actor: actor, p_status: str(body.status, 20) || null, p_limit: Number(body.limit) || 100 } }; break;
      case 'audit': rpc = { name: 'platform_audit_list', args: { p_actor: actor, p_tenant: uuidOf(body.tenant_id), p_from: str(body.from, 40) || null, p_to: str(body.to, 40) || null, p_action: str(body.audit_action, 100) || null, p_limit: Number(body.limit) || 51, p_offset: Math.max(0, Number(body.offset) || 0) } }; break;
      case 'notifications': rpc = { name: 'platform_notifications', args: { p_actor: actor, p_limit: Number(body.limit) || 200 } }; break;
      case 'notifications_read': {
        const ids = Array.isArray(body.ids) ? body.ids.map(uuidOf).filter((id): id is string => !!id).slice(0,500) : [];
        rpc = { name: 'platform_mark_notifications_read', args: { p_actor: actor, p_ids: ids } }; break;
      }
      case 'settings': rpc = { name: 'platform_get_settings', args: { p_actor: actor } }; break;
      case 'settings_set': rpc = { name: 'platform_set_setting', args: { p_actor: actor, p_key: str(body.key, 40), p_value: body.value ?? null } }; break;
      case 'sync': rpc = { name: 'platform_sync_subscriptions', args: {} }; break;
      case 'subscription_create': {
        const id = uuidOf(body.tenant_id); if (!id || !needKey()) return json(req, { error: 'bad_request' }, 400);
        rpc = { name: 'platform_create_subscription', args: { p_actor: actor, p_key: idem, p_tenant: id, p: obj(body.subscription) } }; break;
      }
      case 'subscription_action': {
        const id = uuidOf(body.subscription_id); if (!id || !needKey()) return json(req, { error: 'bad_request' }, 400);
        rpc = { name: 'platform_subscription_action', args: { p_actor: actor, p_key: idem, p_sub: id, p_action: str(body.type, 20), p: obj(body.data) } }; break;
      }
      case 'payment_create': {
        const id = uuidOf(body.tenant_id); const pay = obj(body.payment);
        if (!id || !needKey() || !(Number(pay.amount_kzt) > 0)) return json(req, { error: 'bad_request' }, 400);
        rpc = { name: 'platform_create_payment', args: { p_actor: actor, p_key: idem, p_tenant: id, p: pay } }; break;
      }
      case 'payment_confirm': { const id = uuidOf(body.payment_id); if (!id) return json(req, { error: 'bad_request' }, 400); rpc = { name: 'platform_confirm_payment', args: { p_actor: actor, p_payment: id } }; break; }
      case 'payment_refund': { const id = uuidOf(body.payment_id); if (!id) return json(req, { error: 'bad_request' }, 400); rpc = { name: 'platform_refund_payment', args: { p_actor: actor, p_payment: id, p_reason: str(body.reason, 300) } }; break; }
      case 'payment_fail': { const id = uuidOf(body.payment_id); if (!id) return json(req, { error: 'bad_request' }, 400); rpc = { name: 'platform_fail_payment', args: { p_actor: actor, p_payment: id, p_reason: str(body.reason, 300) || null } }; break; }

      case 'create_tenant': {
        const t = obj(body.tenant);
        const email = str(t.owner_email, 254).toLowerCase();
        const slug = str(t.slug, 40).toLowerCase();
        if (!needKey() || !EMAIL.test(email) || !/^[a-z0-9-]{2,40}$/.test(slug) || str(t.name, 80).length < 2) return json(req, { error: 'bad_request' }, 400);
        const limit = await admin.rpc('consume_platform_rate', { p_scope: 'platform_admin', p_key: `create:${actor}`, p_limit: 30, p_window: 3600 });
        if (limit.error) return json(req, { error: 'temporarily_unavailable' }, 503);
        if (limit.data !== true) return json(req, { error: 'rate_limited' }, 429);

        // владелец: привязываем существующего пользователя или создаём нового (Auth Admin API)
        let owner = await findUserByEmail(admin, email);
        let createdUser = false;
        if (!owner) {
          const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: str(t.owner_name, 120) } });
          if (created.error || !created.data.user) return json(req, { error: 'owner_create_failed' }, 502);
          owner = created.data.user; createdUser = true;
        }
        const { data, error } = await admin.rpc('platform_create_tenant', { p_actor: actor, p_key: idem, p: { ...t, slug, owner_email: email, owner_user_id: owner.id } });
        if (error) {
          // транзакция в БД откатилась целиком; созданный пользователь переиспользуется при повторе
          const code = KNOWN.find((k) => error.message?.includes(k));
          if (code) return json(req, { error: code }, ERROR_STATUS[code] ?? 400);
          console.error('create_tenant failed:', error.message);
          return json(req, { error: 'operation_failed' }, 500);
        }
        // приглашение: письмо для установки пароля (только для вновь созданного пользователя)
        let invited = false;
        if (createdUser && site) {
          const { error: inviteError } = await caller.auth.resetPasswordForEmail(email, { redirectTo: `${site.replace(/\/$/, '')}/s/${slug}/owner` });
          invited = !inviteError;
          if (inviteError) console.error('invite failed:', inviteError.message);
        }
        return json(req, { ...(data as object), owner_user_id: owner.id, owner_created: createdUser, invite_sent: invited });
      }

      case 'resend_invite': {
        const email = str(body.email, 254).toLowerCase(); const slug = str(body.slug, 40).toLowerCase();
        if (!EMAIL.test(email) || !/^[a-z0-9-]{2,40}$/.test(slug) || !site) return json(req, { error: 'bad_request' }, 400);
        const { error } = await caller.auth.resetPasswordForEmail(email, { redirectTo: `${site.replace(/\/$/, '')}/s/${slug}/owner` });
        await admin.rpc('platform_log', { p_actor: actor, p_action: 'owner.resend_invite', p_tenant: null, p_payload: { email, slug } });
        return error ? json(req, { error: 'operation_failed' }, 502) : json(req, { ok: true });
      }
      default: return json(req, { error: 'unknown_action' }, 400);
    }

    const { data, error } = await admin.rpc(rpc.name, rpc.args);
    if (error) {
      const code = KNOWN.find((k) => error.message?.includes(k));
      if (code) return json(req, { error: code }, ERROR_STATUS[code] ?? 400);
      console.error(`${action} failed:`, error.message);
      return json(req, { error: 'operation_failed' }, 500);
    }
    return json(req, { ok: true, data });
  } catch (e) {
    console.error('platform-admin error:', (e as Error).message);
    return json(req, { error: 'temporarily_unavailable' }, 503);
  }
});
