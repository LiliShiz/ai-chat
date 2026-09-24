interface Props {
  model: string | null;
  onPick: (prompt: string) => void;
}

/**
 * Пустое состояние отвечает на три вопроса, которые человек задаёт,
 * впервые увидев поле ввода: что это, что сюда писать, кто отвечает.
 * Подсказки кликабельны — это ещё и самый быстрый способ проверить,
 * что всё работает.
 */
const SUGGESTIONS = [
  'Объясни разницу между debounce и throttle',
  'Напиши regexp для валидации e-mail и объясни его слабые места',
  'Чем SSE лучше WebSocket для стриминга ответа LLM?',
];

export function EmptyState({ model, onPick }: Props) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 className="empty__title" id="empty-title">
        Чат с языковой моделью
      </h2>

      <p className="empty__lead">
        Напишите вопрос — ответ появится по мере генерации. Прервать можно в любой
        момент кнопкой «Стоп» или клавишей <kbd>Esc</kbd>.
      </p>

      <ul className="empty__suggestions">
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
          Отвечает <code>{model}</code>
        </p>
      )}
    </section>
  );
}
