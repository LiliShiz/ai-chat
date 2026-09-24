import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChat } from './useChat';
import type { StreamOutcome } from '../lib/streamChat';

// Сам разбор потока проверяется в streamChat.test.ts. Здесь он
// подменён, чтобы дёргать хук за ниточки: отдать пару токенов,
// оборвать, вернуть ошибку — и смотреть, что стало с лентой.
const streamChat = vi.hoisted(() => vi.fn());
vi.mock('../lib/streamChat', () => ({ streamChat }));

type Deltas = string[];

/** Поток, который отдаёт заданные куски и завершается с заданным исходом. */
function respond(chunks: Deltas, outcome: StreamOutcome = { status: 'done' }) {
  streamChat.mockImplementationOnce(
    async (
      _messages: unknown,
      _signal: AbortSignal,
      onDelta: (text: string) => void,
    ): Promise<StreamOutcome> => {
      for (const chunk of chunks) onDelta(chunk);
      return outcome;
    },
  );
}

const MODEL = 'test/model:free';

beforeEach(() => {
  sessionStorage.clear();
  streamChat.mockReset();
  // rAF в jsdom не тикает сам — батчинг токенов иначе не выльется в state.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('обычный обмен репликами', () => {
  it('добавляет вопрос и собирает ответ из кусков', async () => {
    respond(['При', 'вет']);

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('здравствуй'));

    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'здравствуй' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', content: 'Привет' });
    expect(result.current.error).toBeNull();
  });

  it('подписывает ответ моделью, которая его написала', async () => {
    respond(['ок']);

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages[1]?.model).toBe(MODEL);
  });

  it('не отправляет пустое сообщение', async () => {
    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('   '));

    expect(streamChat).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('передаёт модели всю историю, а не только последнюю реплику', async () => {
    respond(['первый']);
    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('раз'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    respond(['второй']);
    await act(async () => result.current.send('два'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    const [history] = streamChat.mock.calls[1] as [{ role: string; content: string }[]];
    expect(history.map((m) => m.content)).toEqual(['раз', 'первый', 'два']);
    // Служебные поля наружу не уходят — только роль и текст.
    expect(Object.keys(history[0]!).sort()).toEqual(['content', 'role']);
  });
});

describe('остановка', () => {
  it('сохраняет уже полученный кусок и помечает ответ прерванным', async () => {
    // Требование ТЗ: после остановки интерфейс живой, а полученный
    // кусок остаётся в истории.
    respond(['половина ответа'], { status: 'aborted' });

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('длинный вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages[1]).toMatchObject({
      content: 'половина ответа',
      stopped: true,
    });
    expect(result.current.error).toBeNull();
  });

  it('не оставляет в ленте пустой пузырь, если оборвали до первого токена', async () => {
    respond([], { status: 'aborted' });

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: 'user' });
  });
});

describe('ошибки', () => {
  const RATE_LIMIT = {
    status: 'error' as const,
    error: { code: 'rate_limit' as const, message: 'лимит', retryable: true, retryAfterSec: 9 },
  };

  it('показывает ошибку и оставляет вопрос пользователя на месте', async () => {
    respond([], RATE_LIMIT);

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    // Пустой ответ убран, вопрос остался — «Повторить» отправит его.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.error).toMatchObject({ code: 'rate_limit', retryAfterSec: 9 });
  });

  it('сохраняет частичный ответ, если оборвалось посреди генерации', async () => {
    respond(['успел написать'], {
      status: 'error',
      error: { code: 'upstream', message: 'обрыв', retryable: true },
    });

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages[1]).toMatchObject({
      content: 'успел написать',
      failed: true,
    });
  });

  it('повтор отрезает неудачный ответ и переспрашивает то же самое', async () => {
    respond(['мусор'], {
      status: 'error',
      error: { code: 'upstream', message: 'обрыв', retryable: true },
    });

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('мой вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    respond(['нормальный ответ']);
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ content: 'нормальный ответ' });
    expect(result.current.error).toBeNull();

    const [history] = streamChat.mock.calls[1] as [{ content: string }[]];
    expect(history.map((m) => m.content)).toEqual(['мой вопрос']);
  });
});

describe('история', () => {
  it('переживает перемонтирование', async () => {
    respond(['ответ']);
    const first = renderHook(() => useChat(MODEL));
    await act(async () => first.result.current.send('вопрос'));
    await waitFor(() => expect(first.result.current.status).toBe('idle'));
    first.unmount();

    const second = renderHook(() => useChat(MODEL));
    expect(second.result.current.messages.map((m) => m.content)).toEqual(['вопрос', 'ответ']);
  });

  it('очистка стирает и ленту, и хранилище', async () => {
    respond(['ответ']);
    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => result.current.send('вопрос'));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    await act(async () => result.current.clear());

    expect(result.current.messages).toEqual([]);
    expect(JSON.parse(sessionStorage.getItem('ai-chat:history:v1') ?? '[]')).toEqual([]);
  });
});
