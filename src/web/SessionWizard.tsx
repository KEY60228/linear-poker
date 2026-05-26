import { useEffect, useMemo, useState } from "react";
import {
  api,
  apiErrorBody,
  apiErrorCode,
  type ParticipantGroup,
  type Project,
  type StoryPointIssue,
  type Team,
  type User,
  type Viewer,
} from "./api";

type Step = "team" | "project" | "issue" | "participants" | "result";

const STEP_ORDER: Step[] = ["team", "project", "issue", "participants", "result"];
function stepDelta(from: Step, to: Step): number {
  return STEP_ORDER.indexOf(to) - STEP_ORDER.indexOf(from);
}

const HISTORY_KEY = "wizardStep";

function pushStep(s: Step) {
  history.pushState({ [HISTORY_KEY]: s }, "");
}

type IssueStatus = "loading" | "found" | "not_found" | "duplicate" | "error";

type ProjectIssueState = {
  project: Project;
  issue: StoryPointIssue | null;
  included: boolean;
  status: IssueStatus;
  error?: string;
};

type CreateResult = {
  projectId: string;
  projectName: string;
  sessionId?: string;
  existingSessionId?: string;
  error?: string;
};

export function SessionWizard({ viewer }: { viewer: Viewer | null }) {
  const [step, setStep] = useState<Step>("team");

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [team, setTeam] = useState<Team | null>(null);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());

  const [projectIssues, setProjectIssues] = useState<Map<string, ProjectIssueState>>(new Map());
  const [labelName, setLabelName] = useState<string>("story-point");

  const [createResults, setCreateResults] = useState<CreateResult[] | null>(null);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    history.replaceState({ [HISTORY_KEY]: "team" }, "");
  }, []);

  // Browser back: rewind to the popped step. Forward isn't restorable here
  // (we'd need the prior team/project data) so we leave it alone.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const s = (e.state as { [HISTORY_KEY]?: Step } | null)?.[HISTORY_KEY];
      if (s === "team") {
        setTeam(null);
        setProjects(null);
        setSelectedProjectIds(new Set());
        setProjectIssues(new Map());
        setCreateResults(null);
        setStep("team");
      } else if (s === "project") {
        setProjectIssues(new Map());
        setCreateResults(null);
        setStep("project");
      } else if (s === "issue") {
        setCreateResults(null);
        setStep("issue");
      } else if (s === "participants") {
        setCreateResults(null);
        setStep("participants");
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function pickTeam(t: Team) {
    setTeam(t);
    setProjects(null);
    setSelectedProjectIds(new Set());
    setProjectIssues(new Map());
    setCreateResults(null);
    setStep("project");
    pushStep("project");
    setError(null);
    try {
      setProjects(await api.backlogProjects(t.id));
    } catch (e) {
      setError(String(e));
    }
  }

  function toggleProject(p: Project) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }

  function setAllProjects(value: boolean) {
    if (!projects) return;
    setSelectedProjectIds(value ? new Set(projects.map((p) => p.id)) : new Set());
  }

  async function goToIssueStep() {
    if (!projects) return;
    const chosen = projects.filter((p) => selectedProjectIds.has(p.id));
    if (chosen.length === 0) return;
    setStep("issue");
    pushStep("issue");
    setError(null);
    setProjectIssues(
      new Map(
        chosen.map((p) => [
          p.id,
          { project: p, issue: null, included: true, status: "loading" as IssueStatus },
        ]),
      ),
    );
    const results = await Promise.all(
      chosen.map(async (p) => {
        try {
          const res = await api.storyPointIssue(p.id);
          return { p, res, error: null as string | null };
        } catch (e) {
          return { p, res: null, error: String(e) };
        }
      }),
    );
    const entries: [string, ProjectIssueState][] = results.map(({ p, res, error: errMsg }) => {
      if (errMsg) {
        return [
          p.id,
          { project: p, issue: null, included: false, status: "error", error: errMsg },
        ];
      }
      const issue = res!.issue;
      if (!issue) {
        return [p.id, { project: p, issue: null, included: false, status: "not_found" }];
      }
      return [
        p.id,
        {
          project: p,
          issue,
          included: true,
          status: issue.duplicateCount > 0 ? "duplicate" : "found",
        },
      ];
    });
    setProjectIssues(new Map(entries));
    // Pull the labelName from any successful response (they all share it).
    const first = results.find((r) => r.res);
    if (first?.res?.labelName) setLabelName(first.res.labelName);
  }

  function toggleInclude(projectId: string) {
    setProjectIssues((prev) => {
      const next = new Map(prev);
      const cur = next.get(projectId);
      if (!cur) return prev;
      if (!cur.issue) return prev; // can't include a project with no issue
      next.set(projectId, { ...cur, included: !cur.included });
      return next;
    });
  }

  function goToParticipantsStep() {
    setStep("participants");
    pushStep("participants");
  }

  async function createSessions(participantIds: string[]) {
    if (!team) return;
    const included = [...projectIssues.values()].filter((p) => p.included && p.issue);
    if (included.length === 0) return;
    setCreating(true);
    setCreateResults(null);
    setStep("result");
    pushStep("result");
    setError(null);
    const results = await Promise.all(
      included.map(async (item): Promise<CreateResult> => {
        try {
          const { id } = await api.createSession({
            teamId: team.id,
            projectId: item.project.id,
            issueId: item.issue!.id,
            participantIds,
          });
          return {
            projectId: item.project.id,
            projectName: item.project.name,
            sessionId: id,
          };
        } catch (e) {
          if (apiErrorCode(e) === "session_already_exists") {
            const body = apiErrorBody(e);
            const existing =
              body && typeof body.existingSessionId === "string"
                ? body.existingSessionId
                : undefined;
            return {
              projectId: item.project.id,
              projectName: item.project.name,
              existingSessionId: existing,
              error: "session_already_exists",
            };
          }
          return {
            projectId: item.project.id,
            projectName: item.project.name,
            error: String(e),
          };
        }
      }),
    );
    setCreateResults(results);
    setCreating(false);

    // If exactly one session was created and nothing else needs attention,
    // jump straight into it.
    const created = results.filter((r) => !!r.sessionId);
    const noOtherToShow = results.length === created.length;
    if (created.length === 1 && noOtherToShow) {
      window.location.hash = `#/sessions/${created[0]!.sessionId}`;
    }
  }

  function goBackToTeam() {
    history.go(stepDelta(step, "team"));
  }
  function goBackToProject() {
    history.go(stepDelta(step, "project"));
  }
  function goBackToIssue() {
    history.go(stepDelta(step, "issue"));
  }

  const includedCount = [...projectIssues.values()].filter((p) => p.included && p.issue).length;
  const selectedProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter((p) => selectedProjectIds.has(p.id));
  }, [projects, selectedProjectIds]);

  return (
    <section className="wizard">
      <Breadcrumbs
        step={step}
        team={team}
        selectedCount={selectedProjectIds.size}
        includedCount={includedCount}
        onBackToTeam={goBackToTeam}
        onBackToProject={goBackToProject}
        onBackToIssue={goBackToIssue}
      />
      <SelectionContext
        step={step}
        team={team}
        selectedProjects={selectedProjects}
      />
      {error && <p className="error">Error: {error}</p>}

      {step === "team" && <TeamList teams={teams} onPick={pickTeam} />}
      {step === "project" && (
        <ProjectList
          projects={projects}
          selectedIds={selectedProjectIds}
          onToggle={toggleProject}
          onSelectAll={() => setAllProjects(true)}
          onDeselectAll={() => setAllProjects(false)}
          onProceed={goToIssueStep}
        />
      )}
      {step === "issue" && (
        <IssueDetectionPanel
          items={[...projectIssues.values()]}
          labelName={labelName}
          onToggleInclude={toggleInclude}
          canProceed={includedCount > 0}
          onProceed={goToParticipantsStep}
        />
      )}
      {step === "participants" && team && includedCount > 0 && (
        <ParticipantsStep
          team={team}
          viewer={viewer}
          includedCount={includedCount}
          onCreate={createSessions}
          creating={creating}
        />
      )}
      {step === "result" && (
        <ResultPanel results={createResults} creating={creating} />
      )}
    </section>
  );
}

function Breadcrumbs(props: {
  step: Step;
  team: Team | null;
  selectedCount: number;
  includedCount: number;
  onBackToTeam: () => void;
  onBackToProject: () => void;
  onBackToIssue: () => void;
}) {
  const reached = {
    team: true,
    project: !!props.team,
    issue: props.selectedCount > 0,
    participants: false,
    result: false,
  };
  const cls = (s: Step) => {
    if (props.step === s) return "crumb current";
    return reached[s] ? "crumb past" : "crumb future";
  };
  return (
    <nav className="crumbs">
      <button
        className={cls("team")}
        disabled={props.step === "team"}
        onClick={props.onBackToTeam}
      >
        1. Team
      </button>
      <span className="crumb-sep">›</span>
      <button
        className={cls("project")}
        disabled={!reached.project || props.step === "project"}
        onClick={props.onBackToProject}
      >
        2. Projects
      </button>
      <span className="crumb-sep">›</span>
      <button
        className={cls("issue")}
        disabled={!reached.issue || props.step === "issue"}
        onClick={props.onBackToIssue}
      >
        3. Issues
      </button>
      <span className="crumb-sep">›</span>
      <span className={cls("participants")}>4. Participants</span>
    </nav>
  );
}

function SelectionContext({
  step,
  team,
  selectedProjects,
}: {
  step: Step;
  team: Team | null;
  selectedProjects: Project[];
}) {
  const parts: { label: string; node: React.ReactNode }[] = [];
  if (team && step !== "team") {
    parts.push({
      label: "Team",
      node: (
        <a href={team.url} target="_blank" rel="noreferrer">
          {team.key} · {team.name}
        </a>
      ),
    });
  }
  if (selectedProjects.length > 0 && step !== "team" && step !== "project") {
    parts.push({
      label: `Projects (${selectedProjects.length})`,
      node: (
        <span className="project-summary">
          {selectedProjects.slice(0, 3).map((p, i) => (
            <span key={p.id}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.name}
              </a>
              {i < Math.min(selectedProjects.length, 3) - 1 ? ", " : ""}
            </span>
          ))}
          {selectedProjects.length > 3 && (
            <em className="muted"> + {selectedProjects.length - 3} more</em>
          )}
        </span>
      ),
    });
  }
  if (parts.length === 0) return null;
  return (
    <dl className="selection-context">
      {parts.map((p) => (
        <div className="selection-row" key={p.label}>
          <dt>{p.label}</dt>
          <dd>{p.node}</dd>
        </div>
      ))}
    </dl>
  );
}

function TeamList({ teams, onPick }: { teams: Team[] | null; onPick: (t: Team) => void }) {
  if (teams === null) return <p>Loading teams…</p>;
  if (teams.length === 0) return <p>No teams found in your workspace.</p>;
  return (
    <ul className="list">
      {teams.map((t) => (
        <li key={t.id}>
          <button className="row" onClick={() => onPick(t)}>
            <strong>{t.key}</strong>
            <span>{t.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProjectList({
  projects,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onProceed,
}: {
  projects: Project[] | null;
  selectedIds: Set<string>;
  onToggle: (p: Project) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onProceed: () => void;
}) {
  if (projects === null) return <p>Loading projects…</p>;
  if (projects.length === 0) {
    return (
      <p className="muted">
        No Backlog projects in this team. Move a project to <code>Backlog</code> in
        Linear, or pick another team.
      </p>
    );
  }
  return (
    <>
      <div className="bulk-controls">
        <span className="muted">
          {selectedIds.size} / {projects.length} selected
        </span>
        <button onClick={onSelectAll}>Select all</button>
        <button onClick={onDeselectAll}>Deselect all</button>
      </div>
      <ul className="list">
        {projects.map((p) => {
          const picked = selectedIds.has(p.id);
          return (
            <li key={p.id}>
              <button
                className={`row ${picked ? "row-selected" : ""}`}
                onClick={() => onToggle(p)}
              >
                <span>{picked ? "✓" : ""}</span>
                <span>{p.name}</span>
                {p.description && <em className="muted">{p.description}</em>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="actions">
        <button
          className="primary-button"
          disabled={selectedIds.size === 0}
          onClick={onProceed}
        >
          Next: detect StoryPoint issues ({selectedIds.size}) →
        </button>
      </p>
    </>
  );
}

function IssueDetectionPanel({
  items,
  labelName,
  onToggleInclude,
  canProceed,
  onProceed,
}: {
  items: ProjectIssueState[];
  labelName: string;
  onToggleInclude: (projectId: string) => void;
  canProceed: boolean;
  onProceed: () => void;
}) {
  return (
    <>
      <p className="muted">
        Detecting the <code>{labelName}</code>-labelled issue in each selected
        project. Uncheck a row to skip it; "not found" rows can't be included.
      </p>
      <ul className="list">
        {items.map((item) => (
          <li key={item.project.id}>
            <div className="row row-static issue-row">
              <input
                type="checkbox"
                checked={item.included}
                disabled={!item.issue}
                onChange={() => onToggleInclude(item.project.id)}
                aria-label={`Include ${item.project.name}`}
              />
              <span className="ref-main">
                <strong>{item.project.name}</strong>
                {item.status === "loading" && (
                  <em className="muted"> detecting…</em>
                )}
                {item.status === "found" && item.issue && (
                  <em className="muted">
                    {" — "}
                    <a href={item.issue.url} target="_blank" rel="noreferrer">
                      {item.issue.identifier}
                    </a>{" "}
                    {item.issue.title}
                  </em>
                )}
                {item.status === "duplicate" && item.issue && (
                  <em className="muted">
                    {" — "}
                    <a href={item.issue.url} target="_blank" rel="noreferrer">
                      {item.issue.identifier}
                    </a>{" "}
                    {item.issue.title}
                  </em>
                )}
                {item.status === "not_found" && (
                  <em className="muted"> — no StoryPoint issue</em>
                )}
                {item.status === "error" && (
                  <em className="muted"> — {item.error ?? "error"}</em>
                )}
              </span>
              {item.status === "duplicate" && (
                <span className="tag tag-info">duplicate label</span>
              )}
              {item.status === "not_found" && (
                <span className="tag tag-pending">skip</span>
              )}
              {item.status === "error" && (
                <span className="tag tag-pending">error</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="actions">
        <button
          className="primary-button"
          disabled={!canProceed}
          onClick={onProceed}
        >
          Next: pick participants →
        </button>
      </p>
    </>
  );
}

function ParticipantsStep({
  team,
  viewer,
  includedCount,
  onCreate,
  creating,
}: {
  team: Team;
  viewer: Viewer | null;
  includedCount: number;
  onCreate: (participantIds: string[]) => Promise<void>;
  creating: boolean;
}) {
  const [members, setMembers] = useState<User[] | null>(null);
  const [searchResults, setSearchResults] = useState<User[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, { id: string; displayName: string; email: string }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ParticipantGroup[] | null>(null);

  useEffect(() => {
    api
      .teamMembers(team.id)
      .then((users) => {
        setMembers(users);
        if (viewer) {
          const me = users.find((u) => u.id === viewer.id);
          if (me) {
            setSelected((prev) => {
              const next = new Map(prev);
              next.set(me.id, { id: me.id, displayName: me.displayName, email: me.email });
              return next;
            });
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, [team.id, viewer?.id]);

  useEffect(() => {
    api.listGroups(team.id).then(setGroups).catch(() => undefined);
  }, [team.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .searchTeamMembers(team.id, q)
        .then((users) => {
          if (!cancelled) setSearchResults(users);
        })
        .catch((e) => !cancelled && setError(String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, team.id]);

  const candidates = useMemo<User[]>(() => {
    if (searchResults !== null) return searchResults;
    return members ?? [];
  }, [members, searchResults]);

  function toggle(u: User) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, { id: u.id, displayName: u.displayName, email: u.email });
      return next;
    });
  }

  function removeById(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function applyGroup(g: ParticipantGroup) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const m of g.members) {
        if (!next.has(m.userId)) {
          next.set(m.userId, {
            id: m.userId,
            displayName: m.displayName,
            email: m.email,
          });
        }
      }
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    await onCreate([...selected.keys()]);
  }

  return (
    <div className="participants">
      <h3>Pick participants</h3>
      <p className="muted">
        These participants will be added to all {includedCount} session(s).
        Members of this team only — search by name or email to narrow the list.
      </p>
      <input
        className="search"
        type="search"
        placeholder="Search team members (name / email)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {groups && groups.length > 0 && (
        <div className="apply-groups">
          <span className="muted">Apply group:</span>
          {groups.map((g) => (
            <button
              key={g.id}
              className="chip-button"
              onClick={() => applyGroup(g)}
              title={`Add ${g.members.length} member(s)`}
            >
              + {g.name} ({g.members.length})
            </button>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="chips">
          {Array.from(selected.values()).map((u) => (
            <span key={u.id} className="chip">
              {u.displayName}
              <button
                aria-label={`Remove ${u.displayName}`}
                onClick={() => removeById(u.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {members === null && <p>Loading team members…</p>}
      {members !== null && (
        <ul className="list">
          {candidates.map((u) => {
            const picked = selected.has(u.id);
            return (
              <li key={u.id}>
                <button
                  className={`row ${picked ? "row-selected" : ""}`}
                  onClick={() => toggle(u)}
                >
                  <span>{picked ? "✓" : ""}</span>
                  <span>{u.displayName}</span>
                  <em className="muted">{u.email}</em>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="actions">
        <button
          className="primary-button"
          disabled={selected.size === 0 || creating}
          onClick={submit}
        >
          {creating
            ? "Creating sessions…"
            : `Create ${includedCount} session(s) with ${selected.size} participant(s)`}
        </button>
      </p>
      {error && <p className="error">Error: {error}</p>}
    </div>
  );
}

function ResultPanel({
  results,
  creating,
}: {
  results: CreateResult[] | null;
  creating: boolean;
}) {
  if (creating || !results) {
    return <p>Creating sessions…</p>;
  }
  const created = results.filter((r) => r.sessionId);
  const skipped = results.filter((r) => !r.sessionId && r.existingSessionId);
  const failed = results.filter((r) => !r.sessionId && !r.existingSessionId);
  return (
    <div className="bulk-result">
      <h3>Result</h3>
      <p className="muted">
        Created {created.length} · Skipped {skipped.length} · Failed {failed.length}
      </p>
      {created.length > 0 && (
        <section>
          <h4>Created</h4>
          <ul className="list">
            {created.map((r) => (
              <li key={r.projectId}>
                <a className="row row-static" href={`#/sessions/${r.sessionId}`}>
                  <span className="tag tag-ok">created</span>
                  <span className="ref-main">{r.projectName}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {skipped.length > 0 && (
        <section>
          <h4>Skipped (session already exists)</h4>
          <ul className="list">
            {skipped.map((r) => (
              <li key={r.projectId}>
                <a
                  className="row row-static"
                  href={
                    r.existingSessionId ? `#/sessions/${r.existingSessionId}` : "#/"
                  }
                >
                  <span className="tag tag-info">existing</span>
                  <span className="ref-main">{r.projectName}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed.length > 0 && (
        <section>
          <h4>Failed</h4>
          <ul className="list">
            {failed.map((r) => (
              <li key={r.projectId}>
                <div className="row row-static">
                  <span className="tag tag-pending">failed</span>
                  <span className="ref-main">
                    {r.projectName}
                    <em className="muted"> — {r.error}</em>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="actions">
        <a className="primary" href="#/">
          Back to sessions
        </a>
      </p>
    </div>
  );
}
