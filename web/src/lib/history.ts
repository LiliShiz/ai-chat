import type { Message } from '../types';

const KEY = 'ai-chat:history:v1';

/**
 * Почему `sessionStorage`, а не `localStorage` и не «ничего».
 *
 * ТЗ отдаёт это решение кандидату — вот обоснование.
 *
 * 1. «Ничего» проигрывает сразу: случайный F5 или свайп «назад» на телефоне
 *    стирает весь диалог. Это не фича, это потеря данных.
 * 2. `localStorage` живёт вечно и глобально для origin. Переписка с LLM —
 *    это то место, куда люди вставляют куски рабочего кода, письма и личные
 *    данные. Оставлять их на чужой или общей машине до ручной очистки — плохой
 *    дефолт для приватности.
 * 3. `sessionStorage` даёт ровно то, что просит ТЗ («в рамках сессии»):
 *    переживает перезагрузку и навигацию, умирает вместе с вкладкой,
 *    не течёт в соседние вкладки.
 *
 * Если бы понадобилась долгая история — это уже не storage, а аккаунт
 * и сервер, с явным управлением и кнопкой «удалить».
 */
export function loadHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Формат мог поменяться между версиями — отсеиваем всё, что не похоже
    // на сообщение, вместо того чтобы уронить приложение при старте.
    return parsed.filter(isMessage);
  } catch {
    return [];
  }
}

export function saveHistory(messages: Message[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(messages));
  } catch {
    // Квота или приватный режим — история просто не переживёт перезагрузку.
    // Ронять из-за этого работающий чат нельзя.
  }
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Message>;
  return (
    typeof m.id === 'string' &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string'
  );
}
