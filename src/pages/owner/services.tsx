import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchServices, owner } from '../../lib/api'
import { duration } from '../../lib/format'
import { serviceCategories, serviceCategoriesFor } from '../../lib/serviceCatalog'
import { isAutoBusiness } from '../../lib/businessTypes'
import type { Business } from '../../lib/tenant'
import { Err, useAct } from './shared'

function ServiceRow({
  b,
  s,
  onSaved,
  categoryOptions,
}: {
  b: Business
  s: {
    id: string | null
    name: string
    category: string
    price_cents: number
    duration_minutes: number
    active?: boolean
  }
  onSaved: () => void
  categoryOptions: string[]
}) {
  const a = useAct(onSaved)
  const isAuto = isAutoBusiness(b.business_type)
  const [name, setName] = useState(s.name)
  const [category, setCategory] = useState(s.category || 'Другое')
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [price, setPrice] = useState(String(s.price_cents / 100))
  const [min, setMin] = useState(String(s.duration_minutes))
  const [active, setActive] = useState(s.active ?? true)
  const minutes = Number(min)
  const cents = Math.round(Number(price.replace(',', '.')) * 100)
  const ok =
    name.trim() && category.trim().length > 0 && category.trim().length <= 60 && Number.isFinite(cents) && cents >= 0 && Number.isInteger(minutes) && minutes > 0
  const categoryListId = `service-categories-${b.slug}-${s.id ?? 'new'}`
  return (
    <article className="admin-service-row">
      <Err m={a.msg} />
      <div className="admin-service-main">
        <div><label className="muted small" htmlFor={`${categoryListId}-name`}>Название услуги</label><input id={`${categoryListId}-name`} aria-label="Название" className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-input`}>Категория</label>{creatingCategory
          ? <div className="admin-new-category-control"><input id={`${categoryListId}-input`} aria-label="Название новой категории" className="field" maxLength={60} autoFocus placeholder={isAuto ? 'Например, Стёкла' : 'Например, Стрижка'} value={category} onChange={(e) => setCategory(e.target.value)} /><button type="button" className="link" onClick={() => { setCreatingCategory(false); setCategory(s.category || 'Другое'); }}>Отмена</button></div>
          : <select id={`${categoryListId}-input`} aria-label="Категория услуги" className="field" value={category} onChange={(e) => { if (e.target.value === '__create_category__') { setCreatingCategory(true); setCategory(''); } else setCategory(e.target.value); }}>
            {[...new Set([...serviceCategoriesFor(b.business_type), ...categoryOptions])].map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="__create_category__">＋ Создать новую категорию…</option>
          </select>}</div>
        <div><label className="muted small" htmlFor={`${categoryListId}-price`}>Цена, {b.currency}</label><input id={`${categoryListId}-price`} className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        <div><label className="muted small" htmlFor={`${categoryListId}-duration`}>Длительность</label><input id={`${categoryListId}-duration`} className="field" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /><span className="muted small">{ok ? duration(minutes) : 'Укажите минуты'}</span></div>
      </div>
      <div className="admin-service-footer">
        <label className="admin-service-active"><input type="checkbox" checked={active} disabled={a.busy} onChange={(e) => { const next = e.target.checked; if (!s.id) { setActive(next); return; } if (!next && !window.confirm(`Скрыть услугу «${name}»? Она исчезнет из списка услуг и переместится в архив. Её можно будет вернуть в любой момент.`)) return; a.run(async () => { await owner.upsertService(b.slug, { id: s.id, name, category, cents, minutes, active: next }); setActive(next); }) }} /><span className={`admin-service-status ${active ? 'on' : 'off'}`}>Показывать клиентам</span></label>
        <button className="btn mini admin-service-save" disabled={!ok || a.busy} onClick={() => a.run(() => owner.upsertService(b.slug, { id: s.id, name, category, cents, minutes, active }))}>{a.busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </article>
  )
}
export function Services({ b }: { b: Business }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['owner', 'services', b.slug], queryFn: () => fetchServices(b.slug, true) })
  const [n, setN] = useState(0)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Все услуги')
  const [visibilityFilter, setVisibilityFilter] = useState<'Активные' | 'Архив'>('Активные')
  const [servicePage, setServicePage] = useState(1)
  const pageSize = 10
  const saved = () => {
    void qc.invalidateQueries({ queryKey: ['services', b.slug] })
    void qc.invalidateQueries({ queryKey: ['owner', 'services', b.slug] })
  }
  return (
    <>
      <div className="admin-subheading">
        <div><h2>Услуги</h2><p className="muted small">Название, длительность и цена, которые видят клиенты.</p></div>
        {!q.isPending && !q.isError && <span className="admin-count">{q.data.length}</span>}
      </div>
      {q.isPending ? (
        <p className="muted">Загрузка…</p>
      ) : q.isError ? (
        <p className="err">Не удалось загрузить услуги.</p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`admin-service-search-${b.slug}`}>Найти услугу</label>
          <input id={`admin-service-search-${b.slug}`} className="field" type="search" placeholder="Поиск по названию или категории" value={search} onChange={(e) => { setSearch(e.target.value); setServicePage(1); }} />
          {(() => {
            const needle = search.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
            const options = [...new Set([...serviceCategoriesFor(b.business_type), ...serviceCategories(q.data)])]
            const rows = q.data.filter((service) => {
              const matchesSearch = `${service.name} ${service.category}`.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(needle)
              const matchesCategory = categoryFilter === 'Все услуги' || service.category === categoryFilter
              const matchesVisibility = visibilityFilter === 'Активные' ? service.active : !service.active
              return matchesSearch && matchesCategory && matchesVisibility
            })
            const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
            const currentPage = Math.min(servicePage, pageCount)
            const visibleRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
            return <>
              <div className="admin-service-filters">
                <label><span className="muted small">Категория</span><select className="field" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setServicePage(1); }}><option>Все услуги</option>{options.map((item) => <option key={item}>{item}</option>)}</select></label>
                <div className="admin-service-views" role="tablist" aria-label="Услуги и архив"><button type="button" role="tab" aria-selected={visibilityFilter==='Активные'} className={visibilityFilter==='Активные'?'active':''} onClick={()=>{setVisibilityFilter('Активные');setServicePage(1)}}>Услуги <span>{q.data.filter(x=>x.active).length}</span></button><button type="button" role="tab" aria-selected={visibilityFilter==='Архив'} className={visibilityFilter==='Архив'?'active':''} onClick={()=>{setVisibilityFilter('Архив');setServicePage(1)}}>Архив <span>{q.data.filter(x=>!x.active).length}</span></button></div>
                <span className="admin-service-result-count">Найдено <b>{rows.length}</b> из {q.data.length}</span>
              </div>
              <div className="admin-service-table">
                <div className="admin-service-table-head"><span>Услуга</span><span>Категория</span><span>Цена</span><span>Длительность</span></div>
                {visibleRows.map((s) => <ServiceRow key={s.id + s.name} b={b} s={s} categoryOptions={options} onSaved={saved} />)}
              </div>
              {rows.length === 0 && <p className="muted">{visibilityFilter === 'Архив' && !search.trim() ? 'Архив пока пуст.' : 'По этому запросу услуги не найдены.'}</p>}
              {rows.length > pageSize && <nav className="admin-service-pagination" aria-label="Страницы списка услуг">
                <button className="admin-page-button" disabled={currentPage === 1} onClick={() => setServicePage(currentPage - 1)}>Назад</button>
                <span className="muted small">Страница <b>{currentPage}</b> из {pageCount}</span>
                <button className="admin-page-button" disabled={currentPage === pageCount} onClick={() => setServicePage(currentPage + 1)}>Далее</button>
              </nav>}
            </>
          })()}
        </>
      )}
      <div className="admin-subheading admin-subheading-new">
        <div><h3>Добавить услугу</h3><p className="muted small">Она появится в форме записи после сохранения.</p></div>
      </div>
      <div className="admin-new-service">
        <ServiceRow
          key={n}
          b={b}
          s={{ id: null, name: '', category: 'Другое', price_cents: 0, duration_minutes: 60 }}
          categoryOptions={[...new Set([...serviceCategoriesFor(b.business_type), ...serviceCategories(q.data ?? [])])]}
          onSaved={() => {
            saved()
            setN(n + 1)
          }}
        />
      </div>
      <p className="muted small">Изменение цены не затрагивает уже созданные записи.</p>
    </>
  )
}
