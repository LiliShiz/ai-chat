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
export function useChat(): UseChat {
  const [messages, setMessages] = useState<Message[]>(loadHistory);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<ChatError | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Актуальный снимок ленты для обработчиков. Побочные эффекты нельзя класть
  // внутрь updater'а setState: в StrictMode он выполняется дважды и запрос
  // ушёл бы два раза. Поэтому читаем историю отсюда, а не из updater'а.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Токены приходят десятками в секунду. Копим их в ref и выливаем в state
  // один раз за кадр — иначе каждый токен вызывает свой рендер всей ленты.
  const pendingRef = useRef('');
  const frameRef = useRef<number | null>(null);

  useEffect(() => saveHistory(messages), [messages]);

  // Вкладку закрывают посреди генерации — прибираем за собой.
  useEffect(() => () => abortRef.current?.abort(), []);

  const flush = useCallback((assistantId: string) => {
    frameRef.current = null;
    const chunk = pendingRef.current;
    if (!chunk) return;
    pendingRef.current = '';

    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
    );
  }, []);

  const run = useCallback(
    async (history: Message[]) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const assistantId = newId();
      setError(null);
      setStatus('waiting');
      setMessages([...history, { id: assistantId, role: 'assistant', content: '' }]);

      const outcome = await streamChat(
        history.map(({ role, content }) => ({ role, content })),
        controller.signal,
        (text) => {
          setStatus('streaming');
          pendingRef.current += text;
          frameRef.current ??= requestAnimationFrame(() => flush(assistantId));
        },
      );

      // Добираем всё, что не успело вылиться в последнем кадре, — иначе
      // хвост ответа терялся бы ровно в момент остановки.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const tail = pendingRef.current;
      pendingRef.current = '';

      abortRef.current = null;
      setStatus('idle');

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

      if (outcome.status === 'error') setError(outcome.error);
    },
    [flush],
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
    abortRef.current?.abort();
    abortRef.current = null;
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
