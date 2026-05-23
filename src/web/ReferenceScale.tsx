import { useEffect, useMemo, useState } from "react";
import { api, type StoryPointReference, type Team } from "./api";

const SELECTED_TEAM_KEY = "linear-poker:references-team";
const PAGE_SIZE = 10;

export function ReferenceScale() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [issues, setIssues] = useState<StoryPointReference[] | null>(null);
  const [labelName, setLabelName] = useState<string>("story-point");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownPerGroup, setShownPerGroup] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    api
      .teams()
      .then((ts) => {
        setTeams(ts);
        const remembered = sessionStorage.getItem(SELECTED_TEAM_KEY);
        const initial = (remembered && ts.find((t) => t.id === remembered)?.id) ?? ts[0]?.id ?? null;
        setTeamId(initial);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    sessionStorage.setItem(SELECTED_TEAM_KEY, teamId);
    setLoading(true);
    setError(null);
    setShownPerGroup(new Map());
    let cancelled = false;
    api
      .storyPointReferences(teamId)
      .then((r) => {
        if (cancelled) return;
        setIssues(r.issues);
        setLabelName(r.labelName);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  function shownFor(estimate: number): number {
    return shownPerGroup.get(estimate) ?? PAGE_SIZE;
  }

  function showMore(estimate: number) {
    setShownPerGroup((prev) => {
      const next = new Map(prev);
      next.set(estimate, shownFor(estimate) + PAGE_SIZE);
      return next;
    });
  }

  const grouped = useMemo(() => {
    const m = new Map<number, StoryPointReference[]>();
    if (!issues) return m;
    for (const i of issues) {
      const arr = m.get(i.estimate) ?? [];
      arr.push(i);
      m.set(i.estimate, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (a.project?.name ?? a.identifier).localeCompare(b.project?.name ?? b.identifier),
      );
    }
    return m;
  }, [issues]);

  const sortedKeys = [...grouped.keys()].sort((a, b) => a - b);
  const total = issues?.length ?? 0;

  return (
    <section className="references">
      <header className="references-header">
        <div>
          <h2>Reference scale</h2>
          <p className="muted">
            Projects whose <code>{labelName}</code> issue already has an estimate
            in Linear, grouped by point. Use it as a yardstick when sizing a
            new project.
          </p>
        </div>
        {teams && teams.length > 0 && (
          <label className="team-select">
            <span className="muted">Team</span>
            <select
              value={teamId ?? ""}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key} · {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && <p className="error">Error: {error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && issues !== null && total === 0 && (
        <p className="muted">
          No estimated <code>{labelName}</code> issues in this team yet.
        </p>
      )}
      {!loading && total > 0 && (
        <div className="estimate-groups">
          {sortedKeys.map((estimate) => {
            const list = grouped.get(estimate)!;
            const limit = shownFor(estimate);
            const visible = list.slice(0, limit);
            const remaining = list.length - visible.length;
            return (
              <div key={estimate} className="estimate-group">
                <h3 className="estimate-group-title">
                  <span className="estimate-badge">{estimate}</span>
                  <span className="muted">{list.length} project(s)</span>
                </h3>
                <ul className="list">
                  {visible.map((i) => (
                    <li key={i.id}>
                      <div className="row row-static">
                        <span className="ref-main">
                          {i.project ? (
                            <a href={i.project.url} target="_blank" rel="noreferrer">
                              {i.project.name}
                            </a>
                          ) : (
                            <em className="muted">(no project)</em>
                          )}
                        </span>
                        <a
                          className="muted ref-issue"
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {i.identifier}
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
                {remaining > 0 && (
                  <p className="show-more-row">
                    <button
                      className="secondary-button"
                      onClick={() => showMore(estimate)}
                    >
                      Show {Math.min(PAGE_SIZE, remaining)} more
                      <span className="muted"> ({remaining} remaining)</span>
                    </button>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
