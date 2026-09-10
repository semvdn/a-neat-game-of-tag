import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ArtworkErrorBoundary } from './components/ArtworkErrorBoundary';
import { requestExhibitionRecovery } from './services/runtimeRecovery';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

window.addEventListener('error', event => {
  if (event.error instanceof Error) requestExhibitionRecovery(`window:${event.error.name}`);
});
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason instanceof Error ? event.reason.name : 'unhandled-rejection';
  if (requestExhibitionRecovery(`promise:${reason}`)) event.preventDefault();
});

const Boundary = ArtworkErrorBoundary as any;
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>
);
