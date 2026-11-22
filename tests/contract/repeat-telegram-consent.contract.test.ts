import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20261122190000_repeat_telegram_consent.sql');
const bookingCreate = read('supabase/functions/booking-create/index.ts');
const optIn = read('src/components/CustomerTelegramOptIn.tsx');

describe('returning customer Telegram consent', () => {
  it('reuses the latest chat for the same tenant and normalized phone', () => {
    expect(migration).toContain("regexp_replace(coalesce(new.customer_phone, ''), '\\D', '', 'g')");
    expect(migration).toContain('order by l.created_at desc, l.booking_id desc');
    expect(migration).toContain(
      'values (new.tenant_id, new.id, prior.chat_id, prior.consent_at, prior.consent_version, prior.repeat_consent)',
    );
    expect(migration).toContain(
      'create trigger bookings_reuse_telegram_consent_ins\nafter insert on public.bookings',
    );
  });

  it('keeps /stop as a revocation and clears it on a fresh opt-in', () => {
    expect(migration).toContain('create table if not exists public.customer_telegram_optouts');
    expect(migration).toContain(
      'where o.tenant_id = new.tenant_id and o.phone_digits = phone_digits',
    );
    expect(migration).toContain(
      'insert into public.customer_telegram_optouts(tenant_id, phone_digits, chat_id)',
    );
    expect(migration).toContain('delete from public.customer_telegram_optouts');
  });

  it('dispatches the confirmation immediately when a link was inherited', () => {
    expect(bookingCreate).toContain("from('booking_telegram_links')");
    expect(bookingCreate).toContain("Deno.env.get('CRON_SECRET')");
    expect(bookingCreate).toContain('/functions/v1/notify-dispatch');
    expect(bookingCreate).toContain("'x-cron-secret': cronSecret");
  });

  it('does not flash the consent form while the status is unknown', () => {
    expect(optIn).toContain('const [checking, setChecking] = useState(true)');
    expect(optIn).toContain('if (checking) return');
  });
});
