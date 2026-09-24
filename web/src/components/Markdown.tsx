import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { rehypeHighlightSubset } from '../lib/highlight';

/**
 * Рендер ответа модели.
 *
 * Компонент грузится отдельным чанком (см. App.tsx): react-markdown
 * с подсветкой — самая тяжёлая часть бандла, а до первого ответа
 * модели она не нужна ни секунды.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Свой мини-плагин вместо rehype-highlight: тот всегда тянет
      // common-набор highlight.js (~40 грамматик), а нам нужно шесть.
      // Подробности — в lib/highlight.ts.
      rehypePlugins={[rehypeHighlightSubset]}
      components={{ pre: Pre }}
    >
      {children}
    </ReactMarkdown>
  );
}

/** Блок кода с ярлыком языка и копированием. */
function Pre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

  const copy = (event: React.MouseEvent<HTMLButtonElement>) => {
    const pre = event.currentTarget.parentElement?.querySelector('pre');
    const text = pre?.textContent ?? '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {
        // Буфер недоступен (нет https или пользователь запретил) —
        // молча оставляем кнопку в исходном состоянии: ложное
        // «скопировано» хуже, чем отсутствие реакции.
      },
    );
  };

  return (
    <div className="code">
      {language && <span className="code__lang">{language}</span>}
      <button type="button" className="code__copy" onClick={copy}>
        {copied ? 'Скопировано' : 'Копировать'}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

/** Язык лежит в className дочернего <code> как `language-ts`. */
function extractLanguage(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  const className: unknown =
    child && typeof child === 'object' && 'props' in child
      ? (child.props as { className?: string }).className
      : undefined;

  if (typeof className !== 'string') return null;
  return className.match(/language-([\w-]+)/)?.[1] ?? null;
}
