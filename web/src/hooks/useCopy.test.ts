import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCopy } from './useCopy';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('копирование', () => {
  it('копирует и показывает отметку', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    const { result } = renderHook(() => useCopy(50));
    await act(async () => result.current[1]('текст'));

    expect(writeText).toHaveBeenCalledWith('текст');
    await waitFor(() => expect(result.current[0]).toBe(true));
    // Отметка сама гаснет.
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it('не падает, когда буфера обмена нет вовсе', async () => {
    // navigator.clipboard, как и crypto.randomUUID, живёт только в
    // защищённом контексте. По http на IP её нет — без проверки
    // обработчик бросал бы TypeError и кнопка «молчала».
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    const { result } = renderHook(() => useCopy());

    await act(async () => result.current[1]('текст'));
    expect(result.current[0]).toBe(false);
  });

  it('не показывает ложное «скопировано», если буфер отказал', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('запрещено'))) },
    });

    const { result } = renderHook(() => useCopy());
    await act(async () => result.current[1]('текст'));

    expect(result.current[0]).toBe(false);
  });
});
