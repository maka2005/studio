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
  const l = raw ?? {};
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
      included: fallbackPlans[0].included,
    });
  }
  return result.length ? result : null;
}

let cache: Plan[] | null = null;

/** Тарифы сайта: берутся из админки, при ошибке показываются запасные значения. */
export function usePlans(): Plan[] {
  const [plans, setPlans] = useState<Plan[]>(cache ?? fallbackPlans);

  useEffect(() => {
    if (cache) return;
    const controller = new AbortController();
    fetch('/api/platform?action=plans', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const parsed = Array.isArray(json?.data) ? toPlans(json.data as PlanRow[]) : null;
        if (parsed) {
          cache = parsed;
          setPlans(parsed);
        }
      })
      .catch(() => {
        /* остаются запасные значения */
      });
    return () => controller.abort();
  }, []);

  return plans;
}

export function formatLimit(value: number | null, unit: string): string {
  return value === null ? `${unit}: без ограничений` : `${unit}: до ${value.toLocaleString('ru-RU')}`;
}
