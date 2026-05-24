import { useEffect, useState } from "react";
import {
  api,
  type SessionListItem,
  type SessionListScope,
  type SessionListStatusFilter,
} from "./api";

const STATUS_TABS: { id: SessionListStatusFilter; label: string }[] = [
  { id: "voting", label: "Voting" },
  { id: "revealed", label: "Revealed" },
  { id: "finalized", label: "Finalized" },
  { id: "all", label: "All" },
];

export function SessionList() {
  const [scope, setScope] = useState<SessionListScope>("mine");
  const [tab, setTab] = useState<SessionListStatusFilter>("voting");
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    api
      .listSessions(scope, tab)
      .then((r) => !cancelled && setItems(r))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [scope, tab]);

  return (
    <section className="session-list">
      <header className="list-header">
        <div className="scope-toggle" role="tablist" aria-label="Scope">
          <button
            className={`scope-pill ${scope === "mine" ? "scope-active" : ""}`}
            onClick={() => setScope("mine")}
          >
            Mine
          </button>
          <button
            className={`scope-pill ${scope === "all" ? "scope-active" : ""}`}
            onClick={() => setScope("all")}
          >
            Workspace
          </button>
        </div>
        <div className="header-actions">
          <a className="secondary-link" href="#/groups">
            Groups
          </a>
          <a className="secondary-link" href="#/references">
            Reference scale
          </a>
          <a className="primary" href="#/new">
            + New session
          </a>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Status">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="error">Error: {error}</p>}
      {items === null && !error && <p>Loading sessions…</p>}
      {items !== null && items.length === 0 && (
        <p className="muted">
          No sessions{scope === "mine" ? " involving you" : ""} in <em>{tab}</em>.
        </p>
      )}
      {items !== null && items.length > 0 && (
        <ul className="list">
          {items.map((s) => (
            <li key={s.id}>
              <a className="row session-row" href={`#/sessions/${s.id}`}>
                <span className={`badge badge-${s.status}`}>{s.status}</span>
                <span className="session-row-main">
                  <span className="session-row-title">
                    <strong>{s.issue.identifier}</strong> {s.issue.title}
                  </span>
                  <span className="muted">
                    {s.team.key} · {s.project.name} · round #{s.currentRoundNo}
                  </span>
                  <span className="session-row-meta">
                    {s.status === "voting" && (
                      <>
                        <span className="tag tag-ok">
                          {s.votedCount}/{s.participantCount} voted
                        </span>
                        {s.needInfoCount > 0 && (
                          <span className="tag tag-info">
                            {s.needInfoCount} need_info
                          </span>
                        )}
                      </>
                    )}
                    {s.status === "revealed" && (
                      <span className="tag tag-value">awaiting finalize</span>
                    )}
                    {s.status === "finalized" && s.finalEstimate && (
                      <span className="tag tag-value">= {s.finalEstimate.value}</span>
                    )}
                    {(s.isFacilitator || s.isParticipant) && (
                      <span className="muted">
                        {s.isFacilitator ? "facilitator" : "participant"}
                      </span>
                    )}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
