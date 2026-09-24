import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadHistory, saveHistory } from './history';
import type { Message } from '../types';

const KEY = 'ai-chat:history:v1';

const SAMPLE: Message[] = [
  { id: '1', role: 'user', content: 'привет' },
  { id: '2', role: 'assistant', content: 'здравствуйте', model: 'test/model:free' },
];

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('история диалога', () => {
  it('переживает перезагрузку без потерь', () => {
    saveHistory(SAMPLE);
    expect(loadHistory()).toEqual(SAMPLE);
  });

  it('живёт в sessionStorage, а не в localStorage', () => {
    // Осознанное решение: переписка с моделью не должна оставаться
    // на чужой машине после закрытия вкладки.
    saveHistory(SAMPLE);

    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('на пустом хранилище возвращает пустой список', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('не падает на мусоре в хранилище', () => {
    sessionStorage.setItem(KEY, 'это не json');
    expect(loadHistory()).toEqual([]);
  });

  it('не падает, если под ключом лежит объект вместо массива', () => {
    sessionStorage.setItem(KEY, '{"messages":[]}');
    expect(loadHistory()).toEqual([]);
  });

  it('отсеивает записи чужого формата, сохраняя годные', () => {
    // Формат мог поменяться между версиями. Уронить приложение на
    // старте из-за одной неверной записи — худший вариант.
    sessionStorage.setItem(
      KEY,
      JSON.stringify([
        SAMPLE[0],
        { id: 5, role: 'user', content: 'id числом' },
        { id: '6', role: 'system', content: 'чужая роль' },
        { id: '7', role: 'user' },
        null,
        'строка',
        SAMPLE[1],
      ]),
    );

    expect(loadHistory()).toEqual(SAMPLE);
  });

  it('молча переживает недоступное хранилище', () => {
    // Приватный режим или переполненная квота: история не сохранится,
    // но чат обязан остаться рабочим.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => saveHistory(SAMPLE)).not.toThrow();
  });
});
