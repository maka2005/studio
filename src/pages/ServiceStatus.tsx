import { useQuery } from '@tanstack/react-query'
import { BrandMark } from '../components/BrandMark'
import '../styles.css'
import './platform.css'

type HealthCheck = { key:string; label:string; state:'operational'|'down'|'unknown' }
type HealthReport = {
  checked_at:string
  status:'operational'|'degraded'|'outage'
  checks:HealthCheck[]
}

const STATUS:Record<HealthReport['status'],{title:string}>={
  operational:{title:'Все системы работают'},
  degraded:{title:'Есть сбой в работе сервиса'},
  outage:{title:'Сервис временно недоступен'},
}
const CHECK_STATUS:Record<HealthCheck['state'],string>={operational:'Работает',down:'Не работает',unknown:'Нет данных'}
const dateTime=(value:string)=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'medium'}).format(new Date(value))

async function readHealth():Promise<HealthReport>{
  const controller=new AbortController()
  const timeout=window.setTimeout(()=>controller.abort(),7000)
  try{
    const response=await fetch('/api/health',{cache:'no-store',signal:controller.signal})
    if(!response.ok)throw new Error(`HTTP ${response.status}`)
    return await response.json() as HealthReport
  }finally{window.clearTimeout(timeout)}
}

export function ServiceStatus(){
  const health=useQuery({queryKey:['public-service-health'],queryFn:readHealth,refetchInterval:30_000,refetchIntervalInBackground:false,refetchOnWindowFocus:true,retry:false})
  const report=health.data
  const summary=report?STATUS[report.status]:null
  return <main className="page pf-wide service-status-page">
    <header className="pf-app-header"><div className="pf-brand"><span className="pf-brand-mark"><BrandMark size={15} /></span><div><b>Renvio</b><span>Статус сервиса</span></div></div><a className="pf-action-secondary" href="/">На главную</a></header>
    <section className="service-status-wrap">
      <div className="service-status-heading"><div><span className="pf-kicker">СОСТОЯНИЕ ПЛАТФОРМЫ</span><h1>Статус сервиса</h1><p className="muted">Состояние обновляется автоматически.</p></div></div>
      {health.isPending?<section className="service-status-summary"><span className="service-status-indicator is-loading"/><div><h2>Проверяем системы</h2><p className="muted">Получаем свежие ответы компонентов.</p></div></section>:health.isError?<section className="service-status-summary is-down"><span className="service-status-indicator"/><div><h2>Не удалось получить статус</h2><p className="muted">Мониторинг сейчас не отвечает. Попробуйте обновить проверку.</p></div><button className="link" onClick={()=>void health.refetch()}>Повторить</button></section>:report&&<>
        <section className={`service-status-summary is-${report.status}`}><span className="service-status-indicator"/><div><h2>{summary?.title}</h2><p className="muted">Работают {report.checks.filter(check=>check.state==='operational').length} из {report.checks.length} систем</p></div></section>
        <section className="service-status-panel"><div className="service-status-panel-head"><div><h2>Состояние систем</h2><p className="muted small">Последняя проверка: {dateTime(report.checked_at)}</p></div></div><div className="service-check-list">{report.checks.map(check=><div className="service-check-row" key={check.key}><span className={`service-check-dot is-${check.state}`} aria-hidden="true"/><b>{check.label}</b><span className={`service-check-state is-${check.state}`}>{CHECK_STATUS[check.state]}</span></div>)}</div></section>
      </>}
      <p className="service-status-footnote">Статусы проверяются автоматически каждые 30 секунд.</p>
    </section>
  </main>
}
