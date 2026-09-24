import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Шрифты локальные. Literata — вариативная по весу: один файл вместо
// трёх начертаний. Plex Mono нужен только в двух весах, их и берём.
import '@fontsource-variable/literata/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root — проверьте index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
