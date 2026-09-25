/**
 * Идентификатор сообщения.
 *
 * `crypto.randomUUID()` существует только в защищённом контексте —
 * https или localhost. Стоит открыть страницу по обычному http на
 * IP в локальной сети (а это ровно то, как её смотрят с телефона),
 * и метода нет: вызов бросает TypeError прямо в обработчике отправки.
 * Внешне это выглядит как «кнопка нажимается, но ничего не
 * происходит» — ни запроса, ни ошибки на экране.
 *
 * `crypto.getRandomValues` доступен и в незащищённом контексте,
 * поэтому собираем UUID из него. Math.random остаётся последней
 * подпоркой: для ключей списка и сопоставления сообщений
 * криптостойкость не нужна, нужна уникальность в пределах вкладки.
 */
export function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Приводим к виду UUID v4: версия и вариант по RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
