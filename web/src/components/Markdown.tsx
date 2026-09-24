import { useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useCopy } from '../hooks/useCopy';
import { rehypeHighlightSubset } from '../lib/highlight';

/**
 * Рендер ответа модели.
 *
 * Компонент грузится отдельным чанком (см. App.tsx): react-markdown
 * с подсветкой — самая тяжёлая часть бандла, а до первого ответа
 * модели она не нужна ни секунды.
 */
export default function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  // Во время генерации подсветку не гоняем.
  //
  // Разбор идёт по всему блоку кода заново на каждом кадре, то есть
  // O(n²) по длине листинга — на длинном ответе это заметно. И толку
  // от неё нет: код ещё не дописан, грамматика всё равно видит
  // обрывок. Как только поток закончился, блок подсвечивается один
  // раз — и сразу правильно.
  const rehypePlugins = useMemo(() => (streaming ? [] : [rehypeHighlightSubset]), [streaming]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Свой мини-плагин вместо rehype-highlight: тот всегда тянет
      // common-набор highlight.js (~40 грамматик), а нам нужно шесть.
      // Подробности — в lib/highlight.ts.
      rehypePlugins={rehypePlugins}
      components={{ pre: Pre }}
    >
      {children}
    </ReactMarkdown>
  );
}

/** Блок кода с ярлыком языка и копированием. */
function Pre({ children }: { children?: ReactNode }) {
  const [copied, copy] = useCopy();
  const language = extractLanguage(children);

  const handleCopy = (event: React.MouseEvent<HTMLButtonElement>) => {
    const pre = event.currentTarget.parentElement?.querySelector('pre');
    copy(pre?.textContent ?? '');
  };

  return (
    <div className="code">
      {language && <span className="code__lang">{language}</span>}
      <button type="button" className="code__copy" onClick={handleCopy}>
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
