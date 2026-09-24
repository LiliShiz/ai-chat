import { useEffect, useState } from 'react';

import { Composer } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { ErrorNotice } from './components/ErrorNotice';
import { MessageList } from './components/MessageList';
import { useChat } from './hooks/useChat';

export default function App() {
  const { messages, status, error, send, stop, retry, clear } = useChat();
  const model = useModelName();
  const online = useOnline();

  const busy = status !== 'idle';

  // Esc останавливает генерацию из любого места страницы — требование ТЗ.
  // Слушатель глобальный, потому что фокус в этот момент может быть где угодно:
  // на кнопке «Стоп», в поле ввода или вообще нигде.
  useEffect(() => {
    if (!busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, stop]);

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Чат с моделью</h1>

        <p className="header__status" role="status">
          {!online
            ? 'Нет сети'
            : status === 'waiting'
              ? 'Модель думает…'
              : status === 'streaming'
                ? 'Модель печатает…'
                : // Имя модели в шапке дублировало бы пустое состояние,
                  // где оно и так подписано. В шапке — только когда есть диалог.
                  messages.length > 0
                  ? (model ?? '')
                  : ''}
        </p>

        {messages.length > 0 && (
          <button type="button" className="button button--ghost" onClick={clear}>
            Очистить
          </button>
        )}
      </header>

      <main className="main">
        {messages.length === 0 ? (
          <EmptyState model={model} onPick={send} />
        ) : (
          <MessageList messages={messages} status={status} />
        )}
      </main>

      <footer className="footer">
        {error && <ErrorNotice error={error} onRetry={retry} />}
        <Composer busy={busy} onSend={send} onStop={stop} />
      </footer>
    </div>
  );
}

/**
 * Имя модели берём у сервера, а не хардкодим на фронте: модель задаётся
 * переменной окружения, и фронт про неё знать не обязан.
 */
function useModelName(): string | null {
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setModel(data?.model ?? null))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return model;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
