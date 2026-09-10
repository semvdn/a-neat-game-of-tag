import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SimulationErrorBoundary } from './components/SimulationErrorBoundary';
import { requestShowcaseRecovery } from './services/runtimeRecovery';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

window.addEventListener('error', event => {
  if (event.error instanceof Error) requestShowcaseRecovery(`window:${event.error.name}`);
});
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason instanceof Error ? event.reason.name : 'unhandled-rejection';
  if (requestShowcaseRecovery(`promise:${reason}`)) event.preventDefault();
});

const Boundary = SimulationErrorBoundary as any;
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>
);
