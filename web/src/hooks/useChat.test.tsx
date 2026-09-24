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
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
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

/**
 * Поток, которым управляет тест: отдаёт токены по команде и
 * завершается только тогда, когда его попросят. Нужен, чтобы
 * проверять саму отмену, а не подстановку готового исхода.
 */
function controllable() {
  let deliver!: (text: string) => void;
  let finish!: (outcome: StreamOutcome) => void;
  let capturedSignal!: AbortSignal;

  const started = new Promise<void>((resolveStarted) => {
    streamChat.mockImplementationOnce(
      (_messages: unknown, signal: AbortSignal, onDelta: (text: string) => void) => {
        capturedSignal = signal;
        deliver = onDelta;
        resolveStarted();
        return new Promise<StreamOutcome>((resolve) => {
          finish = resolve;
          // Настоящий streamChat на отмене возвращает 'aborted'.
          signal.addEventListener('abort', () => resolve({ status: 'aborted' }), {
            once: true,
          });
        });
      },
    );
  });

  return {
    started,
    deliver: (text: string) => deliver(text),
    finish: (outcome: StreamOutcome = { status: 'done' }) => finish(outcome),
    get signal() {
      return capturedSignal;
    },
  };
}

describe('остановка', () => {
  it('stop() действительно абортит сигнал, с которым ушёл запрос', async () => {
    // Главное свойство: «Стоп» не прячет текст в интерфейсе, а рвёт
    // запрос — значит генерация на сервере прекращается.
    const stream = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('вопрос');
      await stream.started;
    });

    expect(stream.signal.aborted).toBe(false);

    await act(async () => {
      result.current.stop();
    });

    expect(stream.signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });

  it('дописывает хвост буфера, не вылившийся в последнем кадре', async () => {
    // Токены копятся и выливаются в state раз в кадр. Если не добрать
    // остаток при остановке, теряются последние символы — ровно те,
    // что пришли между последним кадром и нажатием «Стоп».
    const stream = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('вопрос');
      await stream.started;
    });

    // Кадр не даём случиться: токены остаются в буфере.
    act(() => stream.deliver('хвост, который чуть не потеряли'));

    await act(async () => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(result.current.messages[1]).toMatchObject({
      content: 'хвост, который чуть не потеряли',
      stopped: true,
    });
  });

  it('во время генерации второе сообщение не отправляется', async () => {
    const stream = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('первый');
      await stream.started;
    });

    await act(async () => result.current.send('второй'));

    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(result.current.messages.map((m) => m.content)).toEqual(['первый', '']);
  });

  it('после «Стоп» сразу можно отправить новое — и его тоже можно остановить', async () => {
    // Та самая гонка: stop() освобождает слот синхронно, а
    // продолжение прерванного запуска досчитывается позже. Если оно
    // затрёт контроллер нового запроса, «Стоп» для него молча умрёт.
    const first = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('первый');
      await first.started;
    });
    act(() => first.deliver('кусок'));

    const second = controllable();
    await act(async () => {
      result.current.stop();
      result.current.send('второй');
      await second.started;
    });

    expect(streamChat).toHaveBeenCalledTimes(2);

    // Даём продолжению первого запуска досчитаться и затереть всё, что
    // оно могло бы затереть.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      result.current.stop();
    });

    expect(second.signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });

  it('после «Стоп» ДО первого токена в модель не уходит пустая реплика', async () => {
    // Сценарий: начал генерацию, сразу передумал, спросил другое.
    // Пустой ответ ассистента ещё висит в ленте — продолжение
    // прерванного запуска его не успело вырезать. Если отдать историю
    // как есть, сервер законно ответит «Сообщение не может быть
    // пустым», и человек увидит ошибку на нормальное действие.
    //
    // Родственный тест выше проверяет случай с НЕпустым ответом —
    // именно поэтому этот сценарий и жил незамеченным.
    const first = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('первый');
      await first.started;
    });

    const second = controllable();
    await act(async () => {
      result.current.stop();
      result.current.send('второй');
      await second.started;
    });

    const [history] = streamChat.mock.calls[1] as [{ role: string; content: string }[]];
    expect(history.every((m) => m.content.trim() !== '')).toBe(true);
    expect(history.map((m) => m.content)).toEqual(['первый', 'второй']);
  });

  it('хвост прерванного потока не утекает в следующее сообщение', async () => {
    const first = controllable();

    const { result } = renderHook(() => useChat(MODEL));
    await act(async () => {
      result.current.send('первый');
      await first.started;
    });
    act(() => first.deliver('старый хвост'));

    const second = controllable();
    await act(async () => {
      result.current.stop();
      result.current.send('второй');
      await second.started;
    });

    act(() => second.deliver('новый текст'));
    await act(async () => {
      second.finish();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));

    const last = result.current.messages.at(-1);
    expect(last?.content).toBe('новый текст');
    expect(last?.content).not.toContain('старый хвост');
  });
});

describe('остановка — маппинг исхода', () => {
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
