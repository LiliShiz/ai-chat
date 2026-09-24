import { useEffect, useState } from 'react';

import type { ChatError } from '../types';

interface Props {
  error: ChatError;
  onRetry: () => void;
}

const TITLES: Record<ChatError['code'], string> = {
  rate_limit: 'Лимит бесплатной модели',
  timeout: 'Модель не ответила вовремя',
  upstream: 'Связь прервалась',
  offline: 'Нет сети',
  bad_request: 'Запрос не принят',
  config: 'Сервер не настроен',
  unknown: 'Что-то пошло не так',
};

export function ErrorNotice({ error, onRetry }: Props) {
  const countdown = useCountdown(error.retryAt);

  return (
    // role="alert" — скринридер сообщит об ошибке сразу, не дожидаясь,
    // пока пользователь доберётся до неё табом.
    <aside className="notice" role="alert">
      <div className="notice__text">
        <strong className="notice__title">{TITLES[error.code]}</strong>
        <p className="notice__message">{error.message}</p>
      </div>

      {error.retryable && (
        <button
          type="button"
          className="button button--ghost"
          onClick={onRetry}
          disabled={countdown > 0}
        >
          {countdown > 0 ? `Повторить через ${countdown} с` : 'Повторить'}
        </button>
      )}
    </aside>
  );
}

/**
 * Обратный отсчёт до момента, когда повтор имеет смысл (Retry-After).
 *
 * Считается от дедлайна, а не уменьшением счётчика по тику. Так
 * отсчёт не врёт, если вкладку свернули и таймеры притормозили, и
 * не приходится сбрасывать state из эффекта при смене props —
 * дедлайн просто пересчитывается вместе с `seconds`.
 */
function useCountdown(deadline: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);

  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
