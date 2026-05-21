import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Project,
  type StoryPointIssue,
  type Team,
  type User,
  type Viewer,
} from "./api";

type Step = "team" | "project" | "issue" | "participants";

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

  async function pickTeam(t: Team) {
    setTeam(t);
    setProject(null);
    setProjects(null);
    setIssue(null);
    setIssueLoaded(false);
    setStep("project");
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

  function goBackToTeam() {
    setTeam(null);
    setProject(null);
    setProjects(null);
    setIssue(null);
    setIssueLoaded(false);
    setStep("team");
  }

  function goBackToProject() {
    setProject(null);
    setIssue(null);
    setIssueLoaded(false);
    setStep("project");
  }

  function goBackToIssue() {
    setStep("issue");
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
      {error && <p className="error">Error: {error}</p>}

      {step === "team" && <TeamList teams={teams} onPick={pickTeam} />}
      {step === "project" && (
        <ProjectList projects={projects} onPick={pickProject} />
      )}
      {step === "issue" && (
        <IssuePreview
          issue={issue}
          project={project}
          labelName={labelName}
          loaded={issueLoaded}
          canProceed={!!issue}
          onRetry={() => project && pickProject(project)}
          onProceed={() => setStep("participants")}
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
  const reached = {
    team: true,
    project: !!props.team,
    issue: !!props.project,
    participants: !!props.issue,
  };
  const cls = (s: Step) => {
    if (props.step === s) return "crumb current";
    return reached[s] ? "crumb" : "crumb future";
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
        2. Project {props.team && <em>({props.team.key})</em>}
      </button>
      <span className="crumb-sep">›</span>
      <button
        className={cls("issue")}
        disabled={!reached.issue || props.step === "issue"}
        onClick={props.onBackToIssue}
      >
        3. Issue {props.project && <em>({props.project.name})</em>}
      </button>
      <span className="crumb-sep">›</span>
      <span className={cls("participants")}>
        4. Participants {props.issue && <em>({props.issue.identifier})</em>}
      </span>
    </nav>
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
  project,
  labelName,
  loaded,
  canProceed,
  onRetry,
  onProceed,
}: {
  issue: StoryPointIssue | null;
  project: Project | null;
  labelName: string;
  loaded: boolean;
  canProceed: boolean;
  onRetry: () => void;
  onProceed: () => void;
}) {
  if (!loaded) return <p>Detecting StoryPoint issue…</p>;

  const projectLink = project && (
    <p className="muted">
      Linear project:{" "}
      <a href={project.url} target="_blank" rel="noreferrer">
        {project.name}
      </a>
    </p>
  );

  if (!issue) {
    return (
      <div className="callout warning">
        <h3>No StoryPoint issue found</h3>
        <p>
          This project has no issue labelled <code>{labelName}</code>. Create one
          (or apply the label to an existing issue) and try again.
        </p>
        {projectLink}
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
      {projectLink}
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
  const [selected, setSelected] = useState<Map<string, User>>(new Map());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              next.set(me.id, me);
              return next;
            });
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, [team.id, viewer?.id]);

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
    const base = members ?? [];
    if (searchResults === null) return base;
    const seen = new Set(base.map((u) => u.id));
    return [...base, ...searchResults.filter((u) => !seen.has(u.id))];
  }, [members, searchResults]);

  function toggle(u: User) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u);
      return next;
    });
  }

  async function createSession() {
    if (selected.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await api.createSession({
        teamId: team.id,
        projectId: project.id,
        issueId: issue.id,
        participantIds: Array.from(selected.keys()),
      });
      window.location.hash = `#/sessions/${id}`;
    } catch (e) {
      setError(String(e));
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
      {error && <p className="error">Error: {error}</p>}

      {selected.size > 0 && (
        <div className="chips">
          {Array.from(selected.values()).map((u) => (
            <span key={u.id} className="chip">
              {u.displayName}
              <button
                aria-label={`Remove ${u.displayName}`}
                onClick={() => toggle(u)}
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
    </div>
  );
}
