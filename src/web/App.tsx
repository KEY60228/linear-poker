import { useEffect, useState } from "react";
import { api, type AuthStatus, type Viewer } from "./api";
import { SessionWizard } from "./SessionWizard";
import { SessionView } from "./SessionView";
import { SessionList } from "./SessionList";
import { ReferenceScale } from "./ReferenceScale";

type Route =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "session"; id: string }
  | { kind: "references" };

function readRoute(): Route {
  const hash = window.location.hash;
  if (hash === "" || hash === "#" || hash === "#/") return { kind: "list" };
  if (hash === "#/new") return { kind: "new" };
  if (hash === "#/references") return { kind: "references" };
  const m = hash.match(/^#\/sessions\/([A-Za-z0-9_-]+)$/);
  if (m && m[1]) return { kind: "session", id: m[1] };
  return { kind: "list" };
}

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(readRoute());

  useEffect(() => {
    api.authStatus().then(setStatus).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    api.me().then(setViewer).catch((e) => setError(String(e)));
  }, [status?.authenticated]);

  useEffect(() => {
    function onHash() {
      setRoute(readRoute());
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

      {status?.authenticated && route.kind === "list" && <SessionList />}
      {status?.authenticated && route.kind === "new" && (
        <SessionWizard viewer={viewer} />
      )}
      {status?.authenticated && route.kind === "session" && (
        <SessionView sessionId={route.id} viewer={viewer} />
      )}
      {status?.authenticated && route.kind === "references" && <ReferenceScale />}
    </main>
  );
}
