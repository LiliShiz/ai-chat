import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'ai-chat:theme';

/**
 * Выбор темы.
 *
 * Хранит именно предпочтение пользователя, а не вычисленную тему:
 * «системная» должна оставаться системной и переключаться вслед за
 * ОС, пока человек не выбрал конкретную сам.
 *
 * Применение — одна строка: `color-scheme` на <html>. Все токены в
 * CSS объявлены через `light-dark()` и читают именно его, а заодно
 * перекрашиваются скроллбары и системные элементы формы, которые
 * иначе пришлось бы стилизовать руками.
 */
export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', preference);

    try {
      localStorage.setItem(KEY, preference);
    } catch {
      // Приватный режим или переполненная квота: тема просто не
      // переживёт перезагрузку. Ронять из-за этого нечего.
    }
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => setPreference(next), []);

  return [preference, choose];
}

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // см. выше
  }
  return 'system';
}
