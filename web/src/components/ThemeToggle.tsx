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
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <circle cx="8" cy="8" r="3.1" />
        <path
          strokeLinecap="round"
          d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'Как в системе',
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <rect x="1.5" y="2.7" width="13" height="8.6" rx="1.2" />
        <path strokeLinecap="round" d="M5.5 13.8h5" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Тёмная тема',
    icon: (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path strokeLinejoin="round" d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.8 5.8 0 1 0 7 7Z" />
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
 * Разметка — радиогруппа, а не три кнопки с `aria-pressed`.
 * Варианты взаимоисключающие, и это ровно тот случай, для которого
 * существует `radiogroup`: в фокус попадает одна остановка вместо
 * трёх, а переключение идёт стрелками, как во всех нативных
 * радиокнопках. Три `aria-pressed` описывали бы три независимых
 * переключателя — то есть врали бы о природе выбора.
 */
export function ThemeToggle({ value, onChange }: Props) {
  const move = (delta: number) => {
    const index = OPTIONS.findIndex((option) => option.value === value);
    const next = OPTIONS[(index + delta + OPTIONS.length) % OPTIONS.length]!;
    onChange(next.value);
  };

  return (
    <div className="theme" role="radiogroup" aria-label="Тема оформления">
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="theme__option"
            aria-checked={selected}
            // Вне группы — одна остановка табом; внутри ходим стрелками.
            tabIndex={selected ? 0 : -1}
            // Только aria-label: вместе с title скринридер прочёл бы
            // одно и то же дважды.
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(1);
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
