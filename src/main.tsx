import { StrictMode, Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof SyntaxError && event.reason.message.includes('Unexpected token')) {
    event.preventDefault();
    console.warn("Suppressed unhandled JSON syntax error:", event.reason);
  }
});


class GlobalErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: any) {
    console.error("Global React error caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 bg-rose-500/20 text-rose-400 rounded-xl flex items-center justify-center mx-auto text-xl font-bold">
              ⚠️
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">LedgerAI Recovery Mode</h1>
            <p className="text-xs text-slate-400">
              An unexpected runtime error was caught safely. Click below to restore normal workspace operations.
            </p>
            <div className="bg-slate-950 p-3 rounded-lg text-[11px] font-mono text-rose-300 text-left overflow-auto max-h-32 border border-slate-800 select-all">
              {this.state.error?.message || 'Unknown runtime exception'}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = '/launcher';
                }}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                Go to Launcher
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch (e) {
                    console.warn('Storage clear blocked:', e);
                  }
                  window.location.href = '/launcher';
                }}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold transition-colors"
              >
                Reset & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
);

// Register Service Worker for offline asset caching
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }).catch((error) => {
      console.log('ServiceWorker registration failed: ', error);
    });
  });
}
