interface Props {
  model: string | null;
  onPick: (prompt: string) => void;
}

/**
 * Пустое состояние отвечает на три вопроса, которые человек задаёт
 * себе, впервые увидев поле ввода: что это, что сюда писать и кто
 * отвечает. Подсказки кликабельны — заодно это самый быстрый способ
 * проверить, что всё работает.
 */
const SUGGESTIONS = [
  'Объясни разницу между debounce и throttle',
  'Напиши regexp для валидации e-mail и разбери его слабые места',
  'Чем SSE лучше WebSocket для стриминга ответа LLM?',
];

export function EmptyState({ model, onPick }: Props) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 className="empty__title" id="empty-title">
        Разговор с языковой моделью
      </h2>

      <p className="empty__lead">
        Ответ появляется по мере генерации — читать можно, не дожидаясь конца.
        Прервать в любой момент: кнопка «Стоп» или клавиша <kbd>Esc</kbd>.
      </p>

      <p className="empty__label" id="suggestions-label">
        С чего начать
      </p>

      <ul className="empty__suggestions" aria-labelledby="suggestions-label">
        {SUGGESTIONS.map((prompt) => (
          <li key={prompt}>
            <button type="button" className="chip" onClick={() => onPick(prompt)}>
              {prompt}
            </button>
          </li>
        ))}
      </ul>

      {model && (
        <p className="empty__model">
          Отвечает {model}
        </p>
      )}
    </section>
  );
}
