import { useEffect, useState } from 'react';
import { fallbackPlans, type Plan, type PlanLimits } from '../data/content';

interface PlanRow {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  price_kzt?: unknown;
  limits?: Record<string, unknown> | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toLimits(raw: PlanRow['limits']): PlanLimits {
  const l: Record<string, unknown> = raw ?? {};
  return {
    employees: num(l.employees),
    services: num(l.services),
    branches: num(l.branches),
    bookingsPerMonth: num(l.bookings_per_month),
  };
}

function toPlans(rows: PlanRow[]): Plan[] | null {
  const fallbackById = new Map(fallbackPlans.map((p) => [p.id, p]));
  const result: Plan[] = [];
  for (const row of rows) {
    const code = typeof row.code === 'string' ? row.code.toLowerCase() : '';
    const price = num(row.price_kzt);
    if (!code || price === null || price <= 0) continue;
    const base = fallbackById.get(code);
    result.push({
      id: code,
      name: typeof row.name === 'string' && row.name ? row.name : code.toUpperCase(),
      price,
      description: base?.description ?? (typeof row.description === 'string' ? row.description : ''),
      highlighted: code === 'pro',
      limits: toLimits(row.limits),
      included: fallbackPlans[0]?.included ?? [],
    });
  }
  return result.length ? result : null;
}

interface PlatformInfo {
  plans: Plan[] | null;
  /** Срок пробного периода из platform_settings.trial_days. */
  trialDays: number | null;
}

let cache: PlatformInfo | null = null;
let pending: Promise<PlatformInfo> | null = null;

/** Один запрос на всех: тарифы и срок пробного периода приходят вместе. */
function loadInfo(): Promise<PlatformInfo> {
  if (cache) return Promise.resolve(cache);
  pending ??= fetch('/api/platform?action=plans')
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      const days = num(json?.trial_days);
      const info: PlatformInfo = {
        plans: Array.isArray(json?.data) ? toPlans(json.data as PlanRow[]) : null,
        trialDays: days !== null && Number.isInteger(days) && days >= 1 && days <= 365 ? days : null,
      };
      if (info.plans || info.trialDays !== null) cache = info;
      return info;
    })
    .catch((): PlatformInfo => ({ plans: null, trialDays: null }))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Тарифы сайта: берутся из админки, при ошибке показываются запасные значения. */
export function usePlans(): Plan[] {
  const [plans, setPlans] = useState<Plan[]>(cache?.plans ?? fallbackPlans);

  useEffect(() => {
    if (cache?.plans) return;
    let alive = true;
    void loadInfo().then((info) => {
      if (alive && info.plans) setPlans(info.plans);
    });
    return () => {
      alive = false;
    };
  }, []);

  return plans;
}

/** Срок пробного периода в днях из базы или null, пока не загружен. */
export function useTrialDays(): number | null {
  const [days, setDays] = useState<number | null>(cache?.trialDays ?? null);

  useEffect(() => {
    if (cache?.trialDays != null) return;
    let alive = true;
    void loadInfo().then((info) => {
      if (alive && info.trialDays !== null) setDays(info.trialDays);
    });
    return () => {
      alive = false;
    };
  }, []);

  return days;
}

export function formatLimit(value: number | null, unit: string): string {
  return value === null ? `${unit}: без ограничений` : `${unit}: до ${value.toLocaleString('ru-RU')}`;
}
