import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';

import type { Message } from '../types';
import type { ChatStatus } from '../hooks/useChat';

const Markdown = lazy(() => import('./Markdown'));

interface Props {
  messages: Message[];
  status: ChatStatus;
  onRegenerate: () => void;
}

/** Насколько близко к низу лента считается «прилипшей». */
const STICK_THRESHOLD = 90;

export function MessageList({ messages, status, onRegenerate }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const pinnedRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Автопрокрутка работает, только пока пользователь внизу. Стоит ему
  // отлистать вверх — лента замирает, иначе нельзя перечитать начало
  // длинного ответа: каждый новый токен утаскивал бы обратно вниз.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      pinnedRef.current = pinned;
      setAtBottom(pinned);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  });

  const jump = useCallback(() => {
    pinnedRef.current = true;
    setAtBottom(true);
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, []);

  const last = messages.at(-1);

  return (
    <>
      <ol className="messages" ref={listRef}>
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            streaming={message === last && status !== 'idle'}
            // Перегенерировать можно только последний ответ: всё, что
            // выше, уже стало контекстом для последующих реплик.
            onRegenerate={message === last && status === 'idle' ? onRegenerate : undefined}
          />
        ))}
        {/* Внутри ol допустимы только li — поэтому якорь тоже li. */}
        <li className="messages__end" ref={endRef} aria-hidden="true" />
      </ol>

      {!atBottom && (
        <button type="button" className="jump" onClick={jump}>
          ↓ К последнему
        </button>
      )}
    </>
  );
}

interface ItemProps {
  message: Message;
  streaming: boolean;
  onRegenerate?: () => void;
}

function MessageItem({ message, streaming, onRegenerate }: ItemProps) {
  const [copied, setCopied] = useState(false);
  const isAssistant = message.role === 'assistant';

  const copy = () => {
    navigator.clipboard.writeText(message.content).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };

  return (
    <li
      className={`message message--${message.role}${
        streaming && message.content ? ' message--streaming' : ''
      }`}
    >
      <span className="message__author">
        {isAssistant ? (
          <>
            Модель {message.model && <em>{message.model}</em>}
          </>
        ) : (
          'Вы'
        )}
      </span>

      <div
        className="message__body"
        // Поток текста озвучивается по мере поступления, но вежливо —
        // не перебивая то, что скринридер читает сейчас.
        aria-live={isAssistant ? 'polite' : undefined}
      >
        {isAssistant ? (
          // Пока чанк с markdown не подгрузился, показываем сырой
          // текст, а не спиннер: содержимое уже есть, прятать его
          // ради загрузки оформления незачем.
          <Suspense fallback={<p>{message.content}</p>}>
            <Markdown>{message.content}</Markdown>
          </Suspense>
        ) : (
          message.content
        )}

        {/* Пока не пришёл первый токен, показываем пульсирующее место
            под ответ: одинокий курсор на пустой строке читается как
            «сломалось», а не как «модель думает».

            Когда текст пошёл, курсор рисуется через ::after последнего
            блока в CSS. Отдельным элементом его сюда не поставить:
            markdown отдаёт блочные <p>, и курсор уезжал бы на свою
            строку под абзацем вместо конца фразы. */}
        {streaming && !message.content && (
          <span className="pending" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>

      {message.stopped && <p className="message__note">Остановлено вами</p>}
      {message.failed && <p className="message__note">Ответ оборвался</p>}

      {isAssistant && !streaming && message.content && (
        <div className="message__tools">
          <button type="button" className="tool" onClick={copy}>
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
          {onRegenerate && (
            <button type="button" className="tool" onClick={onRegenerate}>
              Перегенерировать
            </button>
          )}
        </div>
      )}
    </li>
  );
}
