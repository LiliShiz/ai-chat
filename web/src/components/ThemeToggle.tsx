import type { ReactElement } from 'react';

import type { ThemePreference } from '../hooks/useTheme';

interface Props {
  value: ThemePreference;
  onChange: (next: ThemePreference) => void;
}

const OPTIONS: { value: ThemePreference; label: string; icon: ReactElement }[] = [
  {
    value: 'light',
    label: 'Светлая тема',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="3.1" />
        <path strokeLinecap="round" d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Как в системе',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1.5" y="2.7" width="13" height="8.6" rx="1.2" />
        <path strokeLinecap="round" d="M5.5 13.8h5" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Тёмная тема',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path
          strokeLinejoin="round"
          d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z"
        />
      </svg>
    ),
  },
];

/**
 * Три состояния, а не тумблер на два.
 *
 * Тумблер вынуждает выбрать сторону и навсегда отвязывает интерфейс
 * от настройки ОС: человек, который вечером переключает систему в
 * тёмную, ждёт того же и здесь. «Системная» — это отдельный
 * осмысленный выбор, и он должен быть доступен.
 *
 * Группа помечена role="group" с подписью: иначе скринридер прочтёт
 * три несвязанные кнопки без общего смысла.
 */
export function ThemeToggle({ value, onChange }: Props) {
  return (
    <div className="theme" role="group" aria-label="Тема оформления">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="theme__option"
          // aria-pressed, а не просто класс: нажатое состояние должно
          // быть слышно, а не только видно.
          aria-pressed={value === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
