import { useEffect, useState } from "react";
import { api, type AuthStatus, type Viewer } from "./api";
import { SessionWizard } from "./SessionWizard";

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.authStatus().then(setStatus).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    api.me().then(setViewer).catch((e) => setError(String(e)));
  }, [status?.authenticated]);

  async function logout() {
    await api.logout();
    setStatus({ authenticated: false, userId: null });
    setViewer(null);
  }

  return (
    <main>
      <header className="app-header">
        <h1>Linear Planning Poker</h1>
        {status?.authenticated && (
          <div className="who">
            <span>
              {viewer?.displayName ?? viewer?.name ?? status.userId}
            </span>
            <button onClick={logout}>Logout</button>
          </div>
        )}
      </header>

      {error && <p className="error">Error: {error}</p>}

      {status === null && <p>Loading…</p>}

      {status && !status.authenticated && (
        <div className="login-cta">
          <p className="tagline">Async planning poker for your Linear projects.</p>
          <a className="primary" href="/auth/linear">
            Login with Linear
          </a>
        </div>
      )}

      {status?.authenticated && <SessionWizard />}
    </main>
  );
}
