import { Component, type ReactNode } from 'react';

/** Evita la pantalla en blanco: muestra un mensaje y permite recargar. Los datos no se tocan. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[Stock Manager]', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="splash" role="alert">
        <div className="card card-pad stack" style={{ maxWidth: 440 }}>
          <h1>Algo salió mal</h1>
          <p className="muted">Ocurrió un error inesperado en la pantalla. Tus datos están a salvo en este dispositivo.</p>
          <details className="small muted"><summary>Detalle técnico</summary>{this.state.error.message}</details>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Recargar</button>
        </div>
      </div>
    );
  }
}
