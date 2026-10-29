import { useState } from 'react';

function read(slug: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(`favorites:${slug}`) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
  catch { return []; }
}

export function useFavorites(slug: string) {
  const [items, setItems] = useState<string[]>(() => read(slug));
  const toggle = (name: string) => setItems((old) => {
    const next = old.includes(name) ? old.filter((x) => x !== name) : [...old, name];
    try { localStorage.setItem(`favorites:${slug}`, JSON.stringify(next)); } catch { /* favorites remain available for this page session */ }
    return next;
  });
  return { items, has: (name: string) => items.includes(name), toggle };
}
