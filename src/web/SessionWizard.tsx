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

type Step = "team" | "project" | "issue" | "participants";

const STEP_ORDER: Step[] = ["team", "project", "issue", "participants"];
function stepDelta(from: Step, to: Step): number {
  return STEP_ORDER.indexOf(to) - STEP_ORDER.indexOf(from);
}

const HISTORY_KEY = "wizardStep";
const STORAGE_KEY = "linear-poker:wizard-state";

function pushStep(s: Step) {
  history.pushState({ [HISTORY_KEY]: s }, "");
}

type PersistedState = {
  team: Team | null;
  project: Project | null;
  issue: StoryPointIssue | null;
  labelName: string;
  issueLoaded: boolean;
};

function persist(state: PersistedState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

function readPersisted(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function clearPersisted() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function SessionWizard({ viewer }: { viewer: Viewer | null }) {
  const [step, setStep] = useState<Step>("team");

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [team, setTeam] = useState<Team | null>(null);

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [project, setProject] = useState<Project | null>(null);

  const [issue, setIssue] = useState<StoryPointIssue | null>(null);
  const [labelName, setLabelName] = useState<string>("story-point");
  const [issueLoaded, setIssueLoaded] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.teams().then(setTeams).catch((e) => setError(String(e)));
  }, []);

  // Seed the current history entry. On a normal mount we start at "team",
  // but if the user just navigated back from a session view, the previous
  // history entry's wizardStep tells us where to land. In that case we
  // restore team/project/issue from sessionStorage so the user can pick
  // participants again without re-walking the whole wizard.
  useEffect(() => {
    const s = (history.state as { [HISTORY_KEY]?: Step } | null)?.[HISTORY_KEY];
    if (s && s !== "team") {
      const persisted = readPersisted();
      if (persisted) {
        if (persisted.team) setTeam(persisted.team);
        if (persisted.project) setProject(persisted.project);
        if (persisted.issue) setIssue(persisted.issue);
        if (persisted.labelName) setLabelName(persisted.labelName);
        setIssueLoaded(persisted.issueLoaded);
        setStep(s);
        // Re-fetch projects if we landed on a step that lists them.
        if ((s === "project" || s === "issue" || s === "participants") && persisted.team) {
          api.backlogProjects(persisted.team.id).then(setProjects).catch(() => undefined);
        }
        return;
      }
    }
    history.replaceState({ [HISTORY_KEY]: "team" }, "");
  }, []);

  // Mirror the wizard's data into sessionStorage so a remount (e.g. after
  // browser-back from a created session) can land on the right step. We only
  // write once the user has actually picked something, so the initial null
  // state doesn't clobber a prior persisted snapshot during the restore
  // render cycle.
  useEffect(() => {
    if (team || project || issue) {
      persist({ team, project, issue, labelName, issueLoaded });
    } else if (step === "team") {
      clearPersisted();
    }
  }, [step, team, project, issue, labelName, issueLoaded]);

  // Browser back/forward — rewind the wizard to the popped step.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const s = (e.state as { [HISTORY_KEY]?: Step } | null)?.[HISTORY_KEY];
      if (s === "team") {
        setTeam(null);
        setProject(null);
        setProjects(null);
        setIssue(null);
        setIssueLoaded(false);
        setStep("team");
      } else if (s === "project") {
        setProject(null);
        setIssue(null);
        setIssueLoaded(false);
        setStep("project");
      } else if (s === "issue") {
        // Going back from "participants" — we already detected the issue for
        // the current project, so keep it in state instead of resetting and
        // hanging on "Detecting StoryPoint issue…" forever.
        setStep("issue");
      }
      // "participants" via forward isn't restorable here — the Next button is
      // the only path forward.
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function pickTeam(t: Team) {
    setTeam(t);
    setProject(null);
    setProjects(null);
    setIssue(null);
    setIssueLoaded(false);
    setStep("project");
    pushStep("project");
    setError(null);
    try {
      setProjects(await api.backlogProjects(t.id));
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickProject(p: Project) {
    setProject(p);
    setIssue(null);
    setIssueLoaded(false);
    setStep("issue");
    pushStep("issue");
    setError(null);
    try {
      const res = await api.storyPointIssue(p.id);
      setIssue(res.issue);
      setLabelName(res.labelName);
      setIssueLoaded(true);
    } catch (e) {
      setError(String(e));
    }
  }

  function goToParticipants() {
    setStep("participants");
    pushStep("participants");
  }

  // Breadcrumb "back" buttons go through history.back() so they share the
  // same code path as the browser's back button.
  function goBackToTeam() {
    history.go(stepDelta(step, "team"));
  }
  function goBackToProject() {
    history.go(stepDelta(step, "project"));
  }
  function goBackToIssue() {
    history.go(stepDelta(step, "issue"));
  }

  return (
    <section className="wizard">
      <Breadcrumbs
        step={step}
        team={team}
        project={project}
        issue={issue}
        onBackToTeam={goBackToTeam}
        onBackToProject={goBackToProject}
        onBackToIssue={goBackToIssue}
      />
      <SelectionContext team={team} project={project} issue={issue} step={step} />
      {error && <p className="error">Error: {error}</p>}

      {step === "team" && <TeamList teams={teams} onPick={pickTeam} />}
      {step === "project" && (
        <ProjectList projects={projects} onPick={pickProject} />
      )}
      {step === "issue" && (
        <IssuePreview
          issue={issue}
          labelName={labelName}
          loaded={issueLoaded}
          canProceed={!!issue}
          onRetry={() => project && pickProject(project)}
          onProceed={goToParticipants}
        />
      )}
      {step === "participants" && team && project && issue && (
        <ParticipantsStep
          team={team}
          project={project}
          issue={issue}
          viewer={viewer}
        />
      )}
    </section>
  );
}

function Breadcrumbs(props: {
  step: Step;
  team: Team | null;
  project: Project | null;
  issue: StoryPointIssue | null;
  onBackToTeam: () => void;
  onBackToProject: () => void;
  onBackToIssue: () => void;
}) {
  // Participants is the final step — there's no "past" state, only current
  // (we're on it) or future (we haven't gotten there yet).
  const reached = {
    team: true,
    project: !!props.team,
    issue: !!props.project,
    participants: false,
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
        2. Project
      </button>
      <span className="crumb-sep">›</span>
      <button
        className={cls("issue")}
        disabled={!reached.issue || props.step === "issue"}
        onClick={props.onBackToIssue}
      >
        3. Issue
      </button>
      <span className="crumb-sep">›</span>
      <span className={cls("participants")}>4. Participants</span>
    </nav>
  );
}

function SelectionContext({
  step,
  team,
  project,
  issue,
}: {
  step: Step;
  team: Team | null;
  project: Project | null;
  issue: StoryPointIssue | null;
}) {
  // Show only the items the user has already locked in (skip the one they're
  // currently choosing).
  const parts: { label: string; href: string; text: string }[] = [];
  if (team && step !== "team") {
    parts.push({ label: "Team", href: team.url, text: `${team.key} · ${team.name}` });
  }
  if (project && step !== "project" && step !== "team") {
    parts.push({ label: "Project", href: project.url, text: project.name });
  }
  if (issue && step === "participants") {
    parts.push({
      label: "Issue",
      href: issue.url,
      text: `${issue.identifier} ${issue.title}`,
    });
  }
  if (parts.length === 0) return null;
  return (
    <dl className="selection-context">
      {parts.map((p) => (
        <div className="selection-row" key={p.label}>
          <dt>{p.label}</dt>
          <dd>
            <a href={p.href} target="_blank" rel="noreferrer">
              {p.text}
            </a>
          </dd>
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
  onPick,
}: {
  projects: Project[] | null;
  onPick: (p: Project) => void;
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
    <ul className="list">
      {projects.map((p) => (
        <li key={p.id}>
          <button className="row" onClick={() => onPick(p)}>
            <span>{p.name}</span>
            {p.description && <em className="muted">{p.description}</em>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function IssuePreview({
  issue,
  labelName,
  loaded,
  canProceed,
  onRetry,
  onProceed,
}: {
  issue: StoryPointIssue | null;
  labelName: string;
  loaded: boolean;
  canProceed: boolean;
  onRetry: () => void;
  onProceed: () => void;
}) {
  if (!loaded) return <p>Detecting StoryPoint issue…</p>;

  if (!issue) {
    return (
      <div className="callout warning">
        <h3>No StoryPoint issue found</h3>
        <p>
          This project has no issue labelled <code>{labelName}</code>. Create one
          (or apply the label to an existing issue) and try again.
        </p>
        <button onClick={onRetry}>Retry detection</button>
      </div>
    );
  }

  return (
    <div className="callout">
      <h3>Detected issue</h3>
      <p className="issue-line">
        <a href={issue.url} target="_blank" rel="noreferrer">
          <strong>{issue.identifier}</strong>
        </a>{" "}
        <span>{issue.title}</span>
      </p>
      <p className="muted">
        Current estimate: {issue.estimate === null ? "—" : String(issue.estimate)}
      </p>
      {issue.duplicateCount > 0 && (
        <p className="warning">
          ⚠ {issue.duplicateCount} other issue(s) in this project also carry the{" "}
          <code>{labelName}</code> label. The detection picks the first match —
          consider de-duplicating before creating a session.
        </p>
      )}
      <p className="actions">
        <button className="primary-button" disabled={!canProceed} onClick={onProceed}>
          Next: pick participants →
        </button>
      </p>
    </div>
  );
}

function ParticipantsStep({
  team,
  project,
  issue,
  viewer,
}: {
  team: Team;
  project: Project;
  issue: StoryPointIssue;
  viewer: Viewer | null;
}) {
  const [members, setMembers] = useState<User[] | null>(null);
  const [searchResults, setSearchResults] = useState<User[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, { id: string; displayName: string; email: string }>>(new Map());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingSessionId, setExistingSessionId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ParticipantGroup[] | null>(null);

  useEffect(() => {
    api
      .teamMembers(team.id)
      .then((users) => {
        setMembers(users);
        // Pre-select the viewer (they're creating the session).
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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .searchUsers(q)
        .then((users) => {
          if (!cancelled) setSearchResults(users);
        })
        .catch((e) => !cancelled && setError(String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const candidates = useMemo<User[]>(() => {
    // While the user is searching, show only the search results — otherwise a
    // match that's already a team member looks like the search is ignored.
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

  async function createSession() {
    if (selected.size === 0) return;
    setCreating(true);
    setError(null);
    setExistingSessionId(null);
    try {
      const { id } = await api.createSession({
        teamId: team.id,
        projectId: project.id,
        issueId: issue.id,
        participantIds: Array.from(selected.keys()),
      });
      window.location.hash = `#/sessions/${id}`;
    } catch (e) {
      if (apiErrorCode(e) === "session_already_exists") {
        const body = apiErrorBody(e);
        const existing = body && typeof body.existingSessionId === "string"
          ? body.existingSessionId
          : null;
        setExistingSessionId(existing);
      } else {
        setError(String(e));
      }
      setCreating(false);
    }
  }

  return (
    <div className="participants">
      <h3>Pick participants</h3>
      <p className="muted">
        Team members are listed by default. Search to add anyone else from your
        workspace.
      </p>
      <input
        className="search"
        type="search"
        placeholder="Search workspace users (name / email)…"
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
          onClick={createSession}
        >
          {creating ? "Creating session…" : `Create session (${selected.size} participants)`}
        </button>
      </p>
      {error && <p className="error">Error: {error}</p>}
      {existingSessionId && (
        <div className="callout warning">
          <h4>A session for this issue already exists</h4>
          <p>
            Linear allows only one active planning poker session per StoryPoint
            issue.{" "}
            <a href={`#/sessions/${existingSessionId}`}>Open the existing session →</a>
          </p>
        </div>
      )}
    </div>
  );
}
