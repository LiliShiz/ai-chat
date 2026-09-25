import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

const MAX_ROWS = 8;
/** Минимальный комфортный тач-таргет — совпадает с высотой кнопки. */
const MIN_TARGET = 46;

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;

    const styles = getComputedStyle(el);
    // scrollHeight не включает border, а height при box-sizing: border-box —
    // включает. Без этой поправки поле на пару пикселей ниже содержимого,
    // и браузер рисует в нём паразитный скроллбар со стрелками.
    const chrome =
      parseFloat(styles.borderTopWidth) +
      parseFloat(styles.borderBottomWidth) +
      parseFloat(styles.paddingTop) +
      parseFloat(styles.paddingBottom);
    const lineHeight = parseFloat(styles.lineHeight);

    // Минимум считаем, а не задаём константой: он должен вмещать ровно
    // одну строку текущим шрифтом. Захардкоженное число на пиксель
    // разойдётся с метрикой — и снова появится скроллбар.
    const oneLine = Math.ceil(lineHeight + chrome);
    const min = Math.max(MIN_TARGET, oneLine);

    // Пустое поле — всегда одна строка. Иначе высота считается по
    // плейсхолдеру: на узком экране он переносится, и незаполненное
    // поле открывается двухстрочным без всякой на то причины.
    if (!el.value) {
      el.style.height = `${min}px`;
      return;
    }

    el.style.height = 'auto';
    const fit = Math.min(
      el.scrollHeight +
        parseFloat(styles.borderTopWidth) +
        parseFloat(styles.borderBottomWidth),
      lineHeight * MAX_ROWS + chrome,
    );
    // Округляем вверх: высота считается с долями пикселя (рамка
    // 0.8px при dpr, дробный line-height), clientHeight округляется
    // вниз — и поля не хватает на один пиксель, отчего браузер рисует
    // паразитный скроллбар.
    el.style.height = `${Math.ceil(Math.max(min, fit))}px`;
  }, []);

  // Textarea растёт под текст до потолка, дальше скроллится.
  useEffect(resize, [text, resize]);

  // Пересчитываем ещё в двух случаях, про которые легко забыть:
  //
  // 1. Когда догрузились шрифты. Первый замер идёт системным шрифтом,
  //    а у Literata другая ширина — на узком экране плейсхолдер после
  //    подмены начинает переноситься на вторую строку, и поле,
  //    посчитанное под одну, обрезает текст.
  // 2. Когда изменилась ширина: поворот экрана или появление
  //    клавиатуры меняют число строк при том же тексте.
  useEffect(() => {
    document.fonts?.ready.then(resize).catch(() => {});

    // Наблюдаем за родителем, а не за самим полем: resize меняет его
    // высоту, наблюдатель сработал бы на собственное изменение и ушёл
    // в бесконечный цикл.
    const parent = areaRef.current?.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [resize]);

  // Возвращаем фокус в поле, когда генерация закончилась — чтобы
  // продолжать диалог, не трогая мышь.
  //
  // Именно на переходе «шла → закончилась», а не при каждом idle:
  // иначе фокус забирался бы и при первом рендере (на мобильном это
  // сразу выехавшая клавиатура поверх пустого экрана), и у элемента,
  // куда пользователь ушёл табом, пока читал ответ.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) areaRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  /**
   * Не отдаём фокус поля ввода при нажатии мышью.
   *
   * Только мышью — и это важно. На тач-устройствах браузер шлёт
   * синтетический mousedown уже после touchend, и preventDefault на
   * нём в ряде движков (включая вебвью Телеграма) отменяет и
   * последующий click. Кнопка при этом honestно подсвечивается
   * нажатой, но обработчик не вызывается: «нажимается, а ничего не
   * происходит».
   *
   * Для тача задачу решает другое — `interactive-widget=resizes-content`
   * в viewport: клавиатура сжимает раскладку, и кнопка не уезжает
   * из-под пальца.
   */
  const keepFocus = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') event.preventDefault();
  };

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
        placeholder="Спросите что-нибудь"
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
        <button
          type="button"
          className="button button--stop"
          onPointerDown={keepFocus}
          onClick={onStop}
        >
          Стоп
        </button>
      ) : (
        <button
          type="submit"
          className="button button--send"
          // Не отдаём фокус полю ввода при нажатии.
          //
          // На телефоне иначе так: палец касается кнопки → textarea
          // теряет фокус → экранная клавиатура уезжает → высота
          // видимой области меняется → кнопка уходит из-под пальца
          // раньше, чем касание завершится. Клик не доезжает, и
          // выглядит это как «кнопка не нажимается».
          onPointerDown={keepFocus}
          disabled={!text.trim()}
        >
          Отправить
        </button>
      )}
    </form>
  );
}
