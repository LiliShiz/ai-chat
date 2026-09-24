import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Message } from '../types';
import type { ChatStatus } from '../hooks/useChat';

interface Props {
  messages: Message[];
  status: ChatStatus;
}

export function MessageList({ messages, status }: Props) {
  const endRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);

  // Автопрокрутка — только если пользователь и так внизу. Иначе он не сможет
  // перечитать начало длинного ответа: лента будет утаскивать его вниз.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  });

  return (
    <ol className="messages" ref={listRef}>
      {messages.map((message) => (
        <li
          key={message.id}
          className={`message message--${message.role}`}
          // Поток текста озвучивается скринридером по мере поступления,
          // но вежливо — не перебивая то, что он читает сейчас.
          aria-live={message.role === 'assistant' ? 'polite' : undefined}
        >
          <span className="message__author">
            {message.role === 'user' ? 'Вы' : 'Модель'}
          </span>

          <div className="message__body">
            {message.role === 'assistant' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            ) : (
              message.content
            )}

            {/* Курсор печати живёт внутри пузыря, а не отдельной строкой —
                иначе лента дёргается на каждый переход между состояниями. */}
            {message.role === 'assistant' &&
              message === messages.at(-1) &&
              status !== 'idle' && <span className="caret" aria-hidden="true" />}
          </div>

          {message.stopped && <p className="message__note">Остановлено вами</p>}
          {message.failed && <p className="message__note">Ответ оборвался</p>}
        </li>
      ))}
      {/* Якорь автопрокрутки. Внутри ol допустимы только li — поэтому li,
          а не div: валидность разметки здесь дешевле, чем кажется. */}
      <li className="messages__end" ref={endRef} aria-hidden="true" />
    </ol>
  );
}
