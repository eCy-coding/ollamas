import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {reportWebVitals} from './lib/vitals';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// vF3 — ship field Core Web Vitals to the seyir defteri after paint.
void reportWebVitals();
