import { useEffect, useMemo, useState } from "react";
import { api, type StoryPointReferenceGroup } from "./api";

/**
 * The estimate-grouped reference list for a given team. Used both as the
 * body of the standalone /#/references page and inside the in-session
 * drawer that voters can pop open while picking a number.
 */
export function ReferenceList({ teamId }: { teamId: string }) {
  const [groups, setGroups] = useState<StoryPointReferenceGroup[] | null>(null);
  const [labelName, setLabelName] = useState<string>("story-point");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;
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
    if (!groups) return;
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

  // A project that shows up in more than one estimate bucket is almost
  // always a mis-labelled issue ("duplicate label" in Wizard / Session
  // terms — same project carrying two story-point issues with different
  // estimates). Flag those rows so the user can clean them up in Linear.
  const duplicateProjectIds = useMemo(() => {
    if (!groups) return new Set<string>();
    const counts = new Map<string, number>();
    for (const g of groups) {
      const seen = new Set<string>();
      for (const i of g.issues) {
        if (!i.project) continue;
        if (seen.has(i.project.id)) continue;
        seen.add(i.project.id);
        counts.set(i.project.id, (counts.get(i.project.id) ?? 0) + 1);
      }
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
    );
  }, [groups]);

  return (
    <>
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
                  {g.issues.map((i) => {
                    const isDuplicate =
                      i.project !== null &&
                      duplicateProjectIds.has(i.project.id);
                    return (
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
                          {isDuplicate && (
                            <span
                              className="tag tag-info"
                              title="This project also appears under a different estimate — probably mis-labelled"
                            >
                              duplicate label
                            </span>
                          )}
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
                    );
                  })}
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
    </>
  );
}

function sortIssues<T extends { project: { name: string } | null; identifier: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) =>
    (a.project?.name ?? a.identifier).localeCompare(b.project?.name ?? b.identifier),
  );
}
