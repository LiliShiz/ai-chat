// Общая разметка разговора для всех трёх макетов: меняется только CSS,
// чтобы направления сравнивались честно — на одном и том же содержимом.
window.CHAT = `
<header class="hdr">
  <span class="hdr__brand">Чат с моделью</span>
  <span class="hdr__meta">google/gemma-4-31b-it:free</span>
  <button class="btn btn--ghost" type="button">Очистить</button>
</header>

<ol class="feed">
  <li class="msg msg--user">
    <span class="msg__who">Вы</span>
    <div class="msg__body">Объясни, чем SSE лучше WebSocket для стриминга ответа LLM.</div>
  </li>

  <li class="msg msg--bot">
    <span class="msg__who">Модель <em>google/gemma-4-31b-it:free</em></span>
    <div class="msg__body">
      <p>Поток ответа идёт в одну сторону — от сервера к браузеру. Двусторонний
      канал здесь не нужен, а платить за него приходится.</p>
      <h3>Три причины</h3>
      <ol>
        <li><strong>Это обычный HTTP.</strong> Работает через прокси и CDN, не
        требует отдельного апгрейда соединения.</li>
        <li><strong>Переподключение из коробки.</strong> Браузер сам повторяет
        запрос и передаёт <code>Last-Event-ID</code>.</li>
        <li><strong>Отмена — это просто abort.</strong> Оборвал запрос —
        генерация на сервере прекратилась.</li>
      </ol>
      <pre><code><span class="k">for await</span> (<span class="k">const</span> chunk <span class="k">of</span> stream) {
  render(chunk);
}</code></pre>
      <p>WebSocket оправдан, когда клиент тоже непрерывно шлёт данные — голос,
      курсоры, совместное редактирование.</p>
      <div class="msg__tools">
        <button class="tool" type="button">Копировать</button>
        <button class="tool" type="button">Перегенерировать</button>
      </div>
    </div>
  </li>

  <li class="msg msg--bot msg--live">
    <span class="msg__who">Модель</span>
    <div class="msg__body">
      <p>А ещё SSE проще отлаживать: ответ видно обычным <code>curl -N</code><span class="caret"></span></p>
    </div>
  </li>
</ol>

<footer class="ftr">
  <div class="composer">
    <div class="composer__input">Спросите что-нибудь…</div>
    <button class="btn btn--stop" type="button">Стоп</button>
  </div>
  <p class="hint"><kbd>Enter</kbd> отправить · <kbd>Shift</kbd>+<kbd>Enter</kbd> перенос · <kbd>Esc</kbd> стоп</p>
</footer>
`;
