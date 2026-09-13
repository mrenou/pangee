import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/App';
import '@/index.css';

const container = document.getElementById('root');
if (!container) throw new Error("L'élément #root est introuvable dans index.html.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
