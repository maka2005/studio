import { describe, expect, it } from 'vitest';
import { clientMessages } from '../../src/lib/clientLocale';
import { sameApplicationServerKey, unsupportedNotice } from '../../src/lib/pushSupport';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  chromium:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('unsupportedNotice', () => {
  const push = clientMessages.ru.push;

  it('adds the Home Screen instruction for iPhone Safari', () => {
    expect(unsupportedNotice(push, UA.iphone)).toContain('На главный экран');
  });

  it('adds the Dock instruction for macOS Safari', () => {
    expect(unsupportedNotice(push, UA.macSafari)).toContain('Добавить в Dock');
  });

  it('treats iPadOS desktop-mode UA as mobile Safari', () => {
    expect(unsupportedNotice(push, UA.ipadDesktop, true)).toContain('На главный экран');
  });

  it('keeps the generic message for other browsers', () => {
    expect(unsupportedNotice(push, UA.chromium)).toBe(push.unsupported);
  });

  it('translates the Safari hint to Kazakh', () => {
    expect(unsupportedNotice(clientMessages.kk.push, UA.iphone)).toContain('Басты бетке қосу');
  });
});

describe('sameApplicationServerKey', () => {
  const key = new Uint8Array([1, 2, 3, 4]);

  it('accepts the same bytes from ArrayBuffer and Uint8Array', () => {
    expect(sameApplicationServerKey(key.buffer, key)).toBe(true);
    expect(sameApplicationServerKey(key, key)).toBe(true);
  });

  it('rejects a rotated key, a different length and a missing key', () => {
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3, 9]), key)).toBe(false);
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3]), key)).toBe(false);
    expect(sameApplicationServerKey(null, key)).toBe(false);
  });
});
