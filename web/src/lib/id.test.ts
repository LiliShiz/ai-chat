import { afterEach, describe, expect, it, vi } from 'vitest';

import { newId } from './id';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('идентификаторы сообщений', () => {
  it('в защищённом контексте берёт готовый randomUUID', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID });

    expect(newId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalled();
  });

  it('работает без randomUUID — то есть по http на IP', () => {
    // Главный случай. crypto.randomUUID существует только в
    // защищённом контексте (https или localhost). Страница, открытая
    // с телефона по адресу вида http://192.168.0.4, этого метода не
    // видит — и раньше отправка падала TypeError прямо в обработчике:
    // ни запроса, ни ошибки на экране.
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });

    const id = newId();

    expect(id).toMatch(UUID_SHAPE);
  });

  it('переживает полное отсутствие crypto', () => {
    vi.stubGlobal('crypto', undefined);

    expect(newId()).toMatch(UUID_SHAPE);
  });

  it('не повторяется', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });

    const ids = new Set(Array.from({ length: 500 }, () => newId()));

    expect(ids.size).toBe(500);
  });
});
