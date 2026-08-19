import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../client/utils/apiClient';
import ClientApp from '../ClientApp';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientApp />
  </StrictMode>,
);
