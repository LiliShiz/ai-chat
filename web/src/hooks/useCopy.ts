import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Копирование с временной отметкой «скопировано».
 *
 * Вынесено в хук по двум причинам: одинаковый код лежал в двух местах,
 * и в обоих таймер не снимался при размонтировании — а размонтировать
 * сообщение можно легко, кнопкой «Очистить» прямо после копирования.
 */
export function useCopy(resetAfterMs = 1600): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    (text: string) => {
      if (!text) return;

      // navigator.clipboard тоже живёт только в защищённом контексте.
      // По http на IP её просто нет — без этой проверки обработчик
      // бросает TypeError, и кнопка «молчит».
      const clipboard = navigator.clipboard;
      if (!clipboard) return;

      clipboard.writeText(text).then(
        () => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), resetAfterMs);
        },
        () => {
          // Буфер недоступен (нет https или пользователь запретил).
          // Ложное «скопировано» хуже, чем отсутствие реакции.
        },
      );
    },
    [resetAfterMs],
  );

  return [copied, copy];
}
