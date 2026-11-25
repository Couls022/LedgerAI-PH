import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LicenseAuthorityApp from '../LicenseAuthorityApp';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LicenseAuthorityApp />
  </StrictMode>,
);
