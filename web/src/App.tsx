import { useEffect, useState } from 'react';

import { Composer } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { ErrorNotice } from './components/ErrorNotice';
import { MessageList } from './components/MessageList';
import { ThemeToggle } from './components/ThemeToggle';
import { useChat } from './hooks/useChat';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const model = useModelName();
  const { messages, status, error, send, stop, retry, clear } = useChat(model);
  const [theme, setTheme] = useTheme();
  const online = useOnline();

  const busy = status !== 'idle';

  // Esc останавливает генерацию из любого места страницы — требование
  // ТЗ. Слушатель глобальный, потому что фокус в этот момент может
  // быть где угодно: на кнопке «Стоп», в поле ввода или нигде.
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

  // Чанк с markdown и подсветкой тянем заранее, в простое. К моменту
  // первого ответа он уже на месте — и Suspense не успевает моргнуть.
  useEffect(() => {
    const idle = requestIdleCallbackSafe(() => void import('./components/Markdown'));
    return () => cancelIdleCallbackSafe(idle);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">Чат с моделью</h1>

        <p className="header__status" role="status">
          {!online
            ? 'нет сети'
            : status === 'waiting'
              ? 'модель думает…'
              : status === 'streaming'
                ? 'модель печатает…'
                : // Имя модели в шапке дублировало бы пустое состояние,
                  // где оно и так подписано. Здесь — только в диалоге.
                  messages.length > 0
                  ? (model ?? '')
                  : ''}
        </p>

        <div className="header__actions">
          {messages.length > 0 && (
            <button type="button" className="button button--ghost" onClick={clear}>
              Очистить
            </button>
          )}
          <ThemeToggle value={theme} onChange={setTheme} />
        </div>
      </header>

      <main className="main">
        {messages.length === 0 ? (
          <EmptyState model={model} onPick={send} />
        ) : (
          <MessageList messages={messages} status={status} onRegenerate={retry} />
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
 * Имя модели берём у сервера, а не хардкодим на фронте: модель
 * задаётся переменной окружения, и клиенту знать её неоткуда.
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

// requestIdleCallback до сих пор нет в Safari — деградируем до таймера.
// Каст нужен потому, что TS сужает window до never внутри ветки
// `'requestIdleCallback' in window`, когда типа в lib нет.
function requestIdleCallbackSafe(fn: () => void): number {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  return ric ? ric(fn) : window.setTimeout(fn, 600);
}

function cancelIdleCallbackSafe(handle: number): void {
  const cic = (window as Window & { cancelIdleCallback?: (id: number) => void })
    .cancelIdleCallback;
  if (cic) cic(handle);
  else clearTimeout(handle);
}
