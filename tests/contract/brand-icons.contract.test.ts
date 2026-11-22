import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('brand icons', () => {
  const favicon = read('public/favicon.svg');

  it('uses the orange R on the graphite background', () => {
    expect(favicon).toContain('fill="#C2410C"');
    expect(favicon).toContain('fill="#23262d"');
  });

  it('uses the same graphite in the generated PWA manifest', () => {
    const generator = read('scripts/tenant.mjs');
    expect(generator).toContain("background_color: '#23262d'");
    expect(generator).toContain("theme_color: '#23262d'");

    const manifest = JSON.parse(read('public/tenants/graphite.webmanifest')) as {
      background_color: string;
      theme_color: string;
    };
    expect(manifest.background_color).toBe('#23262d');
    expect(manifest.theme_color).toBe('#23262d');
  });
});
