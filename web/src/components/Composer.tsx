import { useEffect, useRef, useState } from 'react';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_ROWS = 8;

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Textarea растёт под текст до потолка, дальше скроллится.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const styles = getComputedStyle(el);
    // scrollHeight не включает border, а height при box-sizing: border-box —
    // включает. Без этой поправки поле на два пикселя ниже содержимого,
    // и браузер рисует в нём паразитный скроллбар.
    const borders =
      parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    const max = parseFloat(styles.lineHeight) * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight + borders, max)}px`;
  }, [text]);

  // Генерация кончилась — возвращаем фокус в поле, чтобы можно было
  // продолжать диалог, не трогая мышь.
  useEffect(() => {
    if (!busy) areaRef.current?.focus();
  }, [busy]);

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="visually-hidden" htmlFor="composer-input">
        Сообщение для модели
      </label>

      <textarea
        id="composer-input"
        ref={areaRef}
        className="composer__input"
        rows={1}
        value={text}
        placeholder="Спросите что-нибудь…"
        // Enter отправляет, Shift+Enter переносит строку — как ждёт ТЗ
        // и как устроено в любом чате, которым люди пользуются.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        onChange={(event) => setText(event.target.value)}
        aria-describedby="composer-hint"
      />

      <p className="composer__hint" id="composer-hint">
        <kbd>Enter</kbd> — отправить, <kbd>Shift</kbd>+<kbd>Enter</kbd> — перенос строки,{' '}
        <kbd>Esc</kbd> — остановить
      </p>

      {busy ? (
        <button type="button" className="button button--stop" onClick={onStop}>
          Стоп
        </button>
      ) : (
        <button type="submit" className="button button--send" disabled={!text.trim()}>
          Отправить
        </button>
      )}
    </form>
  );
}
