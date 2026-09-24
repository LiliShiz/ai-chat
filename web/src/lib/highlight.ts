import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { toString } from 'hast-util-to-string';
import { createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';
import type { Element, Root } from 'hast';

/**
 * Подсветка на шести языках вместо всех подряд.
 *
 * Готовый `rehype-highlight` всегда тянет `common`-набор highlight.js —
 * это около сорока грамматик и львиная доля веса ленивого чанка.
 * Убрать их опцией нельзя: плагин мержит `languages` поверх common,
 * а не вместо. Поэтому здесь свой мини-плагин поверх `lowlight` —
 * тридцать строк, зато в бандл попадает ровно то, что нужно.
 *
 * Список выбран по тому, что реально просят у чат-модели. Если язык
 * не зарегистрирован, блок остаётся просто моноширинным — это лучше,
 * чем неверная подсветка.
 */
const lowlight = createLowlight({ bash, css, json, python, typescript, xml });

// Один грамматический движок обслуживает семейство: TypeScript
// разбирает и JS, xml — HTML, bash — shell-сессии.
lowlight.registerAlias({
  typescript: ['ts', 'tsx', 'js', 'jsx', 'javascript', 'mjs', 'cjs'],
  xml: ['html', 'svg', 'vue'],
  bash: ['sh', 'shell', 'zsh', 'console'],
  json: ['jsonc'],
  python: ['py'],
});

export function rehypeHighlightSubset() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      // Подсвечиваем только блоки кода: <pre><code class="language-…">.
      // Инлайновый `код` внутри абзаца трогать нечего.
      if (node.tagName !== 'code') return;
      if (!parent || parent.type !== 'element' || parent.tagName !== 'pre') return;

      const language = readLanguage(node);
      // Без явного языка не угадываем: автоопределение на обрывке кода
      // посреди стрима регулярно ошибается и перекрашивает блок на лету.
      if (!language || !lowlight.registered(language)) return;

      try {
        const result = lowlight.highlight(language, toString(node));
        node.children = result.children as Element['children'];
        node.properties = { ...node.properties, className: ['hljs', `language-${language}`] };
      } catch {
        // Грамматика споткнулась о незаконченный код — оставляем
        // блок как есть. Ронять рендер ответа из-за подсветки нельзя.
      }
    });
  };
}

function readLanguage(node: Element): string | null {
  const className = node.properties?.className;
  const list = Array.isArray(className) ? className : [className];

  for (const item of list) {
    const match = typeof item === 'string' && item.match(/^language-([\w-]+)$/);
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}
