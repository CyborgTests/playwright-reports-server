import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import App from './App.tsx';
import './index.css';

dayjs.extend(relativeTime);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
