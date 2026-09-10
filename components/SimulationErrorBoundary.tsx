import React from 'react';
import { isShowcaseRequested, requestShowcaseRecovery } from '../services/runtimeRecovery';

type State = { error: Error | null; recoveryAttempted: boolean };

export class SimulationErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, recoveryAttempted: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, recoveryAttempted: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Fatal simulation render error:', error, info);
    if (isShowcaseRequested()) {
      const recoveryAttempted = requestShowcaseRecovery(`react:${error.name}`);
      if (recoveryAttempted) this.setState({ recoveryAttempted: true });
    }
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    const showcase = isShowcaseRequested();
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-gray-950 p-6 text-gray-200">
        <section className="max-w-lg rounded-xl border border-red-500/30 bg-gray-900 p-6 shadow-2xl">
          <h1 className="text-lg font-semibold text-red-300">Simulation runtime stopped</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            {showcase && this.state.recoveryAttempted
              ? 'The showcase encountered an error and is reloading from the bundled checkpoint.'
              : 'Automatic recovery was unable to continue safely. Reload the page to restart from the bundled showcase checkpoint.'}
          </p>
          {!this.state.recoveryAttempted && (
            <button className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-bold text-gray-950" onClick={() => window.location.reload()}>
              Restart simulation
            </button>
          )}
        </section>
      </main>
    );
  }
}
