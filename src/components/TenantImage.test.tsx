import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TenantImage } from './TenantImage';

const STORAGE_SRC =
  'https://example.supabase.co/storage/v1/object/public/tenant-media/logo.png';

describe('TenantImage', () => {
  it('после ошибки трансформации загружает оригинал из storage', async () => {
    render(<TenantImage src={STORAGE_SRC} alt="Логотип" width={40} height={40} priority />);
    const initial = screen.getByAltText('Логотип');
    expect(document.querySelector('source')?.getAttribute('srcset')).toContain(
      '/storage/v1/render/image/',
    );

    fireEvent.error(initial);

    await waitFor(() => expect(document.querySelector('source')).toBeNull());
    expect(screen.getByAltText('Логотип')).not.toBe(initial);
    expect(screen.getByAltText('Логотип').getAttribute('src')).toBe(STORAGE_SRC);
  });

  it('если и оригинал недоступен, показывает заглушку и не зацикливается', async () => {
    render(<TenantImage src={STORAGE_SRC} alt="Логотип" width={40} height={40} priority />);
    fireEvent.error(screen.getByAltText('Логотип'));
    await waitFor(() => expect(document.querySelector('source')).toBeNull());

    fireEvent.error(screen.getByAltText('Логотип'));
    await waitFor(() =>
      expect(screen.getByAltText('Логотип').getAttribute('src')).toBe('/servio-default.svg'),
    );
    fireEvent.error(screen.getByAltText('Логотип'));
    expect(screen.getByAltText('Логотип').getAttribute('src')).toBe('/servio-default.svg');
  });
});
