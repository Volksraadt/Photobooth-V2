import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { RootErrorBoundary } from './error-boundary';
import './kiosk.css';
import { readSettings } from './settings';
import { StripPreview } from './strip-preview';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

const settings = readSettings();
const view = new URLSearchParams(window.location.search).get('view');

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      {settings.dev && view === 'strip' ? (
        <StripPreview configUrl={settings.configUrl} />
      ) : (
        <App settings={settings} />
      )}
    </RootErrorBoundary>
  </StrictMode>,
);
