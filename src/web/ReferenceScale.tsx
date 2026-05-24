import { useEffect, useState } from "react";
import {
  api,
  type StoryPointReferenceGroup,
  type Team,
} from "./api";

const SELECTED_TEAM_KEY = "linear-poker:references-team";

export function ReferenceScale() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [groups, setGroups] = useState<StoryPointReferenceGroup[] | null>(null);
  const [labelName, setLabelName] = useState<string>("story-point");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

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
    let cancelled = false;
    api
      .storyPointReferences(teamId)
      .then((r) => {
        if (cancelled) return;
        setGroups(
          [...r.groups]
            .sort((a, b) => a.estimate - b.estimate)
            .map((g) => ({
              ...g,
              issues: sortIssues(g.issues),
            })),
        );
        setLabelName(r.labelName);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  async function loadMore(estimate: number) {
    if (!teamId || !groups) return;
    const group = groups.find((g) => g.estimate === estimate);
    if (!group || !group.hasNextPage || !group.endCursor) return;
    setLoadingMore((prev) => new Set(prev).add(estimate));
    try {
      const page = await api.storyPointReferencesMore(teamId, estimate, group.endCursor);
      setGroups((prev) =>
        prev?.map((g) =>
          g.estimate === estimate
            ? {
                ...g,
                issues: sortIssues([...g.issues, ...page.issues]),
                endCursor: page.endCursor,
                hasNextPage: page.hasNextPage,
              }
            : g,
        ) ?? null,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingMore((prev) => {
        const next = new Set(prev);
        next.delete(estimate);
        return next;
      });
    }
  }

  const total = groups?.reduce((sum, g) => sum + g.issues.length, 0) ?? 0;
  const anyHasMore = groups?.some((g) => g.hasNextPage) ?? false;

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
      {!loading && groups !== null && total === 0 && !anyHasMore && (
        <p className="muted">
          No estimated <code>{labelName}</code> issues in this team yet.
        </p>
      )}
      {!loading && groups !== null && groups.length > 0 && (
        <div className="estimate-groups">
          {groups.map((g) => (
            <div key={g.estimate} className="estimate-group">
              <h3 className="estimate-group-title">
                <span className="estimate-badge">{g.estimate}</span>
                <span className="muted">
                  {g.issues.length}
                  {g.hasNextPage ? "+" : ""} project(s)
                </span>
              </h3>
              {g.issues.length === 0 && !g.hasNextPage ? (
                <p className="muted">No projects estimated at this point.</p>
              ) : (
                <ul className="list">
                  {g.issues.map((i) => (
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
              )}
              {g.hasNextPage && (
                <p className="show-more-row">
                  <button
                    className="secondary-button"
                    onClick={() => loadMore(g.estimate)}
                    disabled={loadingMore.has(g.estimate)}
                  >
                    {loadingMore.has(g.estimate) ? "Loading…" : "Show more"}
                  </button>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function sortIssues<T extends { project: { name: string } | null; identifier: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) =>
    (a.project?.name ?? a.identifier).localeCompare(b.project?.name ?? b.identifier),
  );
}
