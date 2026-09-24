import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Последний рубеж против белого экрана.
 *
 * Сетевые аварии обрабатываются в `useChat` и показываются плашкой.
 * Но исключение в рендере — например, грамматика подсветки
 * споткнулась о неожиданный ввод, — обработчиками не ловится: React
 * размонтирует всё дерево, и человек видит пустую страницу без
 * единого объяснения. Ровно то, что ТЗ называет недопустимым.
 *
 * Классовый компонент здесь не по традиции: хуками границу ошибок
 * до сих пор не сделать.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // В проде здесь был бы вызов в Sentry. В тестовом задании —
    // консоль, но с контекстом, а не просто проглоченная ошибка.
    console.error('Сбой в интерфейсе:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app">
        <main className="main">
          <section className="empty" role="alert">
            <h2 className="empty__title">Интерфейс сломался</h2>
            <p className="empty__lead">
              Что-то пошло не так при отрисовке. Переписка сохранена — она в хранилище вкладки и
              вернётся после перезагрузки.
            </p>
            <p className="empty__label">Что произошло</p>
            <pre>{this.state.error.message}</pre>
            <p>
              <button type="button" className="button" onClick={() => window.location.reload()}>
                Перезагрузить
              </button>
            </p>
          </section>
        </main>
      </div>
    );
  }
}
