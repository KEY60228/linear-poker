import { useEffect, useState } from "react";
import { api, type AuthStatus, type Viewer } from "./api";
import { SessionWizard } from "./SessionWizard";
import { SessionView } from "./SessionView";

function readSessionIdFromHash(): string | null {
  const hash = window.location.hash;
  const m = hash.match(/^#\/sessions\/([A-Za-z0-9_-]+)$/);
  return m ? (m[1] ?? null) : null;
}

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(readSessionIdFromHash());

  useEffect(() => {
    api.authStatus().then(setStatus).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    api.me().then(setViewer).catch((e) => setError(String(e)));
  }, [status?.authenticated]);

  useEffect(() => {
    function onHash() {
      setSessionId(readSessionIdFromHash());
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function logout() {
    await api.logout();
    setStatus({ authenticated: false, userId: null });
    setViewer(null);
    window.location.hash = "";
  }

  function goHome() {
    window.location.hash = "";
  }

  return (
    <main>
      <header className="app-header">
        <h1>
          <a className="home-link" href="#" onClick={(e) => { e.preventDefault(); goHome(); }}>
            Linear Planning Poker
          </a>
        </h1>
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

      {status?.authenticated && sessionId && (
        <SessionView sessionId={sessionId} viewer={viewer} />
      )}
      {status?.authenticated && !sessionId && <SessionWizard viewer={viewer} />}
    </main>
  );
}
