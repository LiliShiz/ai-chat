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
  const countdown = useCountdown(error.retryAfterSec);

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

/** Обратный отсчёт до момента, когда повтор имеет смысл (Retry-After от 429). */
function useCountdown(seconds: number | undefined): number {
  const [left, setLeft] = useState(seconds ?? 0);

  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return;

    const id = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          clearInterval(id);
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [seconds]);

  return left;
}
