import { useCallback, useEffect, useRef, useState } from 'react';

import { streamChat } from '../lib/streamChat';
import { loadHistory, saveHistory } from '../lib/history';
import type { ChatError, Message } from '../types';

export type ChatStatus =
  /** Ждём ввода. */
  | 'idle'
  /** Запрос ушёл, первый токен ещё не пришёл. */
  | 'waiting'
  /** Модель печатает. */
  | 'streaming';

export interface UseChat {
  messages: Message[];
  status: ChatStatus;
  error: ChatError | null;
  send: (text: string) => void;
  stop: () => void;
  retry: () => void;
  clear: () => void;
}

/**
 * Вся логика диалога: одно место, где живёт состояние, отмена и восстановление
 * истории. Компоненты остаются немыми — их легко читать и переставлять.
 */
export function useChat(model: string | null): UseChat {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<ChatError | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Актуальный снимок ленты для обработчиков. Побочные эффекты нельзя класть
  // внутрь updater'а setState: в StrictMode он выполняется дважды и запрос
  // ушёл бы два раза. Поэтому читаем историю отсюда, а не из updater'а.
  const messagesRef = useRef(messages);
  // Синхронизируем после коммита, а не во время рендера: запись в ref
  // на рендере — источник трудноуловимых рассинхронов, и линтер
  // ругается справедливо. Обработчикам этого достаточно: они срабатывают
  // уже после того, как React применил изменения.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => saveHistory(messages), [messages]);

  // Вкладку закрывают посреди генерации — прибираем за собой.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (rawHistory: Message[]) => {
      // Выбрасываем пустые сообщения.
      //
      // Сценарий: пользователь начал генерацию, сразу нажал «Стоп» и
      // спросил другое. Продолжение прерванного запуска, которое
      // вырезает пустой ответ из ленты, к этому моменту ещё не
      // отработало — и в модель уезжала история с пустой репликой
      // ассистента посередине. Сервер её законно отклонял, а человек
      // видел «Запрос не принят» на совершенно нормальное действие.
      const history = rawHistory.filter((m) => m.content.trim() !== '');

      const controller = new AbortController();
      abortRef.current = controller;

      const assistantId = newId();
      setError(null);
      setStatus('waiting');
      setMessages([
        ...history,
        { id: assistantId, role: 'assistant', content: '', model: model ?? undefined },
      ]);

      // Буфер токенов — локальный для запуска, а не ref на весь хук.
      // Общий буфер при «Стоп → сразу отправить» отдавал хвост старого
      // потока новому сообщению: два запуска делили одну переменную.
      //
      // Токены приходят десятками в секунду, поэтому копим их здесь и
      // выливаем в state раз в кадр — иначе каждый токен перерисовывает
      // всю ленту.
      let pending = '';
      let frame: number | null = null;

      const flush = () => {
        frame = null;
        const chunk = pending;
        if (!chunk) return;
        pending = '';
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
        );
      };

      const outcome = await streamChat(
        history.map(({ role, content }) => ({ role, content })),
        controller.signal,
        (text) => {
          setStatus('streaming');
          pending += text;
          frame ??= requestAnimationFrame(flush);
        },
      );

      // Добираем всё, что не успело вылиться в последнем кадре, — иначе
      // хвост ответа терялся бы ровно в момент остановки.
      if (frame !== null) cancelAnimationFrame(frame);
      const tail = pending;
      pending = '';

      // Обнуляем ссылку, только если она всё ещё наша.
      //
      // Сценарий, который ломался: пользователь жмёт Esc и сразу Enter.
      // stop() уже обнулил abortRef синхронно, send() положил туда
      // контроллер НОВОГО запроса — и это продолжение, дойдя сюда,
      // затирало его. После чего «Стоп» для нового запроса молча не
      // работал, а защита от двойной отправки пропускала второй запрос.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStatus('idle');
      }

      setMessages((prev) =>
        prev.flatMap((m) => {
          if (m.id !== assistantId) return [m];
          const content = m.content + tail;
          // Пустой ответ при ошибке — мусор в ленте. Текст пользователя
          // при этом остаётся, и «Повторить» отправит именно его.
          if (!content && outcome.status !== 'done') return [];
          return [
            {
              ...m,
              content,
              stopped: outcome.status === 'aborted' || undefined,
              failed: outcome.status === 'error' || undefined,
            },
          ];
        }),
      );

      if (outcome.status === 'error') {
        const { retryAfterSec } = outcome.error;
        setError({
          ...outcome.error,
          retryAt: retryAfterSec ? Date.now() + retryAfterSec * 1000 : undefined,
        });
      }
    },
    [model],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || abortRef.current) return;

      const history: Message[] = [
        ...messagesRef.current,
        { id: newId(), role: 'user', content },
      ];
      setMessages(history);
      void run(history);
    },
    [run],
  );

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    // Освобождаем слот сразу, не дожидаясь, пока досчитается
    // асинхронное продолжение run(): иначе между нажатием «Стоп» и
    // разрешением промиса интерфейс считался бы занятым и не принимал
    // новое сообщение. Гонку за этот слот снимает проверка на
    // идентичность контроллера в конце run().
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const retry = useCallback(() => {
    if (abortRef.current) return;

    // Отрезаем всё после последнего сообщения пользователя и просим заново.
    const prev = messagesRef.current;
    const lastUser = prev.findLastIndex((m) => m.role === 'user');
    if (lastUser === -1) return;

    const history = prev.slice(0, lastUser + 1);
    setMessages(history);
    void run(history);
  }, [run]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setError(null);
    setMessages([]);
  }, []);

  return { messages, status, error, send, stop, retry, clear };
}

function newId(): string {
  return crypto.randomUUID();
}
