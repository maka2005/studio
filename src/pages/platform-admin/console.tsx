import { useEffect, useState } from 'react';
import { Logo } from '../../components/BrandMark';
import { Dashboard } from './dashboard';
import { BillingDocuments, Payments, Plans, Subscriptions } from './billing';
import { Admins, Audit, BusinessLeads, PlatformNotifications, PlatformServiceAdmin, Settings, SupportQueue } from './operations';
import { CreateTenant, TenantCard, Tenants } from './tenants';
import { PLATFORM_ROLE_LABEL, TABS, call, useLoad, type LeadPrefill, type Row, type Tab } from './shared';

export function Console({ onLogout, role, accountEmail }: { onLogout: () => void; onMfa: () => void; role: string; accountEmail: string }) {
  const [tab, setTab] = useState<Tab>(role === 'support' ? 'Поддержка' : 'Главная');
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  const [leadPrefill, setLeadPrefill] = useState<LeadPrefill | null>(null);
  const platformNotices=useLoad<Row[]>('notifications',{limit:200})
  // A new response is surfaced even when the administrator stays on another section.
  useEffect(()=>{const timer=window.setInterval(()=>void platformNotices.reload(),30_000);return()=>window.clearInterval(timer)},[platformNotices.reload])
  const visibleTabs = TABS.filter((t) => {
    if (role === 'owner') return true;
    if (t === 'Поддержка') return role === 'support';
    if (t === 'Заявки с сайта') return role === 'support' || role === 'owner';
    if(t==='Объявления и статус')return false;
    if (t === 'Администраторы') return false;
    if (t === 'Новая организация' || t === 'Настройки') return false;
    if (role === 'finance') return !['Организации','Уведомления','Администраторы','Настройки'].includes(t);
    if (role === 'read_only') return !['Уведомления','Документы'].includes(t);
    return !['Главная','Подписки','Тарифы','Платежи','Настройки'].includes(t);
  });
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(role === 'support' ? 'Поддержка' : 'Главная'); }, [role]);
  return (
    <main className="page pf-wide">
      <header className="pf-app-header"><div className="pf-brand"><div><b className="pf-wordmark"><Logo height={12} /></b><span>Platform console</span></div></div><div className="pf-header-actions"><span className="pf-header-user">{PLATFORM_ROLE_LABEL[role] ?? 'Нет доступа'}{accountEmail && <><br/><small>{accountEmail}</small></>}</span><button className="pf-logout" onClick={onLogout}>Выйти</button></div></header>
      <div className="pf-console-layout"><nav className="pf-tabs" aria-label="Разделы платформы">{visibleTabs.map((t) => <button key={t} className={tab === t && !openTenant ? 'is-current' : ''} onClick={() => { setOpenTenant(null); setTab(t); if(t==='Уведомления'){const ids=platformNotices.data?.filter(x=>!x.is_read).map(x=>String(x.id))??[];if(ids.length)void call('notifications_read',{ids}).then(()=>platformNotices.reload())} }}>{t}{t==='Уведомления'&&platformNotices.data?.some(x=>!x.is_read)&&<i className="admin-unread-dot" aria-label="Есть непрочитанные уведомления"/>}</button>)}</nav>
      <section className="pf-console-content">{openTenant ? <TenantCard id={openTenant} role={role} onBack={() => setOpenTenant(null)} />
        : tab === 'Главная' ? <Dashboard onOpen={setOpenTenant} onNavigate={setTab} />
        : tab === 'Организации' ? <Tenants onOpen={setOpenTenant} />
        : tab === 'Поддержка' ? <SupportQueue />
        : tab === 'Заявки с сайта' ? <BusinessLeads canConnect={role === 'owner'} onConnect={(lead) => { setLeadPrefill(lead); setTab('Новая организация'); }} />
        : tab === 'Новая организация' ? <CreateTenant key={leadPrefill?.id ?? 'new'} prefill={leadPrefill} onCreated={(id) => { setLeadPrefill(null); setOpenTenant(id); }} />
        : tab === 'Подписки' ? <Subscriptions onOpen={setOpenTenant} />
        : tab === 'Тарифы' ? <Plans />
        : tab === 'Платежи' ? <Payments />
        : tab === 'Документы' ? <BillingDocuments />
        : tab === 'Объявления и статус' ? <PlatformServiceAdmin />
        : tab === 'Уведомления' ? <PlatformNotifications />
        : tab === 'Журнал' ? <Audit />
        : tab === 'Администраторы' ? <Admins />
        : <Settings />}</section></div>
    </main>);
}
