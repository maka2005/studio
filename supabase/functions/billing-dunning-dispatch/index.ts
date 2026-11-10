import { createClient } from 'npm:@supabase/supabase-js@2';

const env=(key:string)=>Deno.env.get(key)??'';
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]??char));
type BillingEmail={id:string;recipient_email:string;kind:string;dedupe_key:string;payload:Record<string,unknown>;attempts:number;subscription_id:string|null};

function emailContent(kind:string,payload:Record<string,unknown>,siteUrl:string,supportEmail:string){
  const organization=String(payload.organization_name??'ваша организация');
  const slug=String(payload.slug??'');
  const plan=String(payload.plan_name??payload.plan_code??'текущий тариф');
  const amount=Number(payload.price_kzt??payload.amount_kzt??0).toLocaleString('ru-RU');
  const timezone=String(payload.timezone??'Asia/Almaty');
  const endsAt=payload.ends_at?new Date(String(payload.ends_at)):null;
  const endDate=endsAt&&!Number.isNaN(endsAt.getTime())?new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeZone:timezone}).format(endsAt):'';
  const days=kind==='ending_7d'?7:3;
  const subject=kind==='ending_7d'?`Servio: до окончания подписки ${days} дней`:kind==='ending_3d'?`Servio: подписка закончится через ${days} дня`:kind==='payment_failed'?'Servio: платёж не подтверждён':'Servio: подписка приостановлена';
  let message='';
  if(kind==='ending_7d'||kind==='ending_3d'){
    message=`Срок подписки организации «${organization}» заканчивается ${endDate?`<b>${escapeHtml(endDate)}</b>`:`через ${days} дн.`}. Тариф: <b>${escapeHtml(plan)}</b>; стоимость продления — <b>${amount} ₸</b>. Чтобы сохранить доступ без перерыва, свяжитесь с поддержкой и запросите продление.`;
  }else if(kind==='payment_failed'){
    const reason=String(payload.reason??'');
    message=`Платёж на <b>${amount} ₸</b> для организации «${organization}» не был подтверждён. Если оплата уже отправлена, напишите в поддержку и приложите подтверждение перевода.${reason?`<br><br>Комментарий: ${escapeHtml(reason)}`:''}`;
  }else{
    const reason=String(payload.reason??'');
    message=`Подписка организации «${organization}» приостановлена. Онлайн-запись и уведомления отключены, данные организации сохранены. Для восстановления доступа свяжитесь с поддержкой Servio и запросите реквизиты для оплаты тарифа «${escapeHtml(plan)}» (${amount} ₸).${reason?`<br><br>Причина приостановки: ${escapeHtml(reason)}`:''}`;
  }
  const cabinetUrl=`${siteUrl.replace(/\/+$/,'')}/s/${encodeURIComponent(slug)}/owner`;
  const html=`<!doctype html><html lang="ru"><body style="margin:0;background:#f4f6fa;color:#172033;font:16px/1.55 Arial,sans-serif"><main style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e2e7ef;border-radius:16px"><p style="margin:0 0 16px;color:#3976ef;font-weight:700">SERVIO · ПОДПИСКА</p><h1 style="margin:0 0 20px;font-size:24px">${escapeHtml(subject.replace('Servio: ',''))}</h1><p>${message}</p><p style="margin:24px 0"><a href="${escapeHtml(cabinetUrl)}" style="display:inline-block;padding:12px 18px;background:#3976ef;color:#fff;text-decoration:none;border-radius:9px;font-weight:700">Открыть кабинет организации</a></p><p>Если вопрос касается оплаты или приостановки, напишите в поддержку: <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p><hr style="border:0;border-top:1px solid #e2e7ef;margin:24px 0"><p style="color:#68758a;font-size:13px">Это автоматическое уведомление о состоянии подписки Servio.</p></main></body></html>`;
  const text=[subject,'',`${organization} · тариф ${plan} · ${amount} ₸`,'',kind==='ending_7d'||kind==='ending_3d'?`Срок подписки заканчивается ${endDate||`через ${days} дн.`}. Чтобы не потерять доступ, свяжитесь с поддержкой и запросите продление.`:kind==='payment_failed'?`Платёж не подтверждён. Если вы уже оплатили, напишите в поддержку и приложите подтверждение перевода.${payload.reason?` Причина: ${String(payload.reason)}`:''}`:`Подписка приостановлена. Онлайн-запись и уведомления отключены, данные сохранены. Для восстановления доступа свяжитесь с поддержкой Servio.${payload.reason?` Причина: ${String(payload.reason)}`:''}`,'',`Поддержка: ${supportEmail}`,`Кабинет организации: ${cabinetUrl}`].join('\n');
  return {subject,html,text};
}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return new Response('method_not_allowed',{status:405});
  if(!env('CRON_SECRET')||req.headers.get('x-cron-secret')!==env('CRON_SECRET'))return new Response('forbidden',{status:403});

  const apiKey=env('RESEND_API_KEY');
  const from=env('BILLING_EMAIL_FROM');
  const supportEmail=env('BILLING_SUPPORT_EMAIL');
  const siteUrl=env('SITE_URL');
  if(!apiKey||!from||!supportEmail||!siteUrl||!/^\S+@\S+\.\S+$/.test(supportEmail))return Response.json({enabled:false,reason:'email_provider_not_configured'});

  const admin=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
  const {error:enqueueError}=await admin.rpc('enqueue_platform_billing_reminders');
  if(enqueueError)return Response.json({error:'reminder_enqueue_failed'},{status:500});
  const {data:jobs,error:leaseError}=await admin.rpc('lease_platform_billing_emails',{p_limit:20});
  if(leaseError)return Response.json({error:'email_queue_unavailable'},{status:500});

  let sent=0,failed=0,skipped=0;
  for(const job of (jobs??[]) as BillingEmail[]){
    try{
      if(job.subscription_id){
        const {data:subscription,error}=await admin.from('subscriptions').select('status,ends_at').eq('id',job.subscription_id).maybeSingle();
        if(error)throw error;
        const sameEnd=subscription?.ends_at&&job.payload.ends_at&&new Date(subscription.ends_at).getTime()===new Date(String(job.payload.ends_at)).getTime();
        const stale=!subscription||((job.kind==='ending_7d'||job.kind==='ending_3d')&&(!['trial','active','grace'].includes(subscription.status)||!sameEnd))||(job.kind==='subscription_suspended'&&subscription.status!=='suspended');
        if(stale){await admin.rpc('finish_platform_billing_email',{p_id:job.id,p_sent:false,p_error:'skip:subscription_changed'});skipped++;continue;}
      }
      const {subject,html,text}=emailContent(job.kind,job.payload,siteUrl,supportEmail);
      const response=await fetch('https://api.resend.com/emails',{
        method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':job.dedupe_key},
        body:JSON.stringify({from,to:[job.recipient_email],reply_to:supportEmail,subject,html,text}),signal:AbortSignal.timeout(10000),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.id){
        const message=String(result.message??`email_provider_http_${response.status}`).slice(0,200);
        await admin.rpc('finish_platform_billing_email',{p_id:job.id,p_sent:false,p_error:message});failed++;continue;
      }
      const {error:finishError}=await admin.rpc('finish_platform_billing_email',{p_id:job.id,p_sent:true,p_message_id:String(result.id)});
      if(finishError)throw finishError;
      sent++;
    }catch(error){
      await admin.rpc('finish_platform_billing_email',{p_id:job.id,p_sent:false,p_error:String((error as Error).message).slice(0,200)});
      failed++;
    }
  }
  return Response.json({sent,failed,skipped});
});
