import { useEffect, useState } from "react";

type Viewer = { id: string; name: string; email: string; displayName: string };
type AuthStatus = { authenticated: boolean; userId: string | null };

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json() as Promise<AuthStatus>)
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    fetch("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<Viewer>) : Promise.reject(r.statusText)))
      .then(setViewer)
      .catch((e) => setError(String(e)));
  }, [status?.authenticated]);

  async function logout() {
    await fetch("/auth/logout", { method: "POST" });
    setStatus({ authenticated: false, userId: null });
    setViewer(null);
  }

  return (
    <main>
      <h1>Linear Planning Poker</h1>
      <p className="tagline">Async planning poker for your Linear projects.</p>

      {error && <p className="error">Error: {error}</p>}

      {status === null && <p>Loading…</p>}

      {status && !status.authenticated && (
        <a className="primary" href="/auth/linear">
          Login with Linear
        </a>
      )}

      {status?.authenticated && (
        <section>
          <p>
            Logged in as <strong>{viewer?.displayName ?? viewer?.name ?? status.userId}</strong>
          </p>
          <button onClick={logout}>Logout</button>
          <p className="muted">v0.1 skeleton — session/voting UI arrives in v0.2.</p>
        </section>
      )}
    </main>
  );
}
