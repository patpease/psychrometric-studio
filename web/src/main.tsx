/** Application entry point. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';
import { rescueProject } from './io/rescue.js';
import './ui/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * The boundary wraps the whole application rather than a part of it.
 *
 * A narrower boundary would keep more of the page alive, and would also be a
 * guess about which part is safe to keep — a chart drawn from state the solver
 * choked on is worse than an honest failure. The project is offered back
 * instead; see ErrorBoundary.
 */
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary rescue={() => rescueProject() ?? ''}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
