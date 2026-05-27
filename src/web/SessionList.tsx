import { useEffect, useMemo, useState } from "react";
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

  // For the Voting tab, split into "needs your vote" and the rest. Other
  // tabs stay as a single flat list.
  const sections = useMemo(() => {
    if (items === null) return null;
    if (tab !== "voting") {
      return [{ key: "all", title: null, rows: items }];
    }
    const needsVote: SessionListItem[] = [];
    const waiting: SessionListItem[] = [];
    for (const s of items) {
      if (s.isParticipant && !s.viewerHasVoted) needsVote.push(s);
      else waiting.push(s);
    }
    return [
      { key: "needs", title: "Vote needed", rows: needsVote },
      { key: "waiting", title: "Waiting for others", rows: waiting },
    ];
  }, [items, tab]);

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
      {sections &&
        items !== null &&
        items.length > 0 &&
        sections.map((section) =>
          section.rows.length === 0 ? null : (
            <div key={section.key} className="session-section">
              {section.title && (
                <h3 className="session-section-title">
                  {section.title}{" "}
                  <span className="muted">({section.rows.length})</span>
                </h3>
              )}
              <ul className="list">
                {section.rows.map((s) => (
                  <SessionRow key={s.id} s={s} />
                ))}
              </ul>
            </div>
          ),
        )}
    </section>
  );
}

function SessionRow({ s }: { s: SessionListItem }) {
  const needsYourVote =
    s.status === "voting" && s.isParticipant && !s.viewerHasVoted;
  return (
    <li>
      <a
        className={`row session-row ${needsYourVote ? "session-row-urgent" : ""}`}
        href={`#/sessions/${s.id}`}
      >
        <span className={`badge badge-${s.status}`}>{s.status}</span>
        <span className="session-row-main">
          <span className="session-row-title">{s.project.name}</span>
          <span className="muted">
            <strong>{s.issue.identifier}</strong> {s.issue.title}
          </span>
          <span className="muted">
            {s.team.key} · round #{s.currentRoundNo}
          </span>
          <span className="session-row-meta">
            {needsYourVote && (
              <span className="tag tag-urgent">vote needed</span>
            )}
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
  );
}
