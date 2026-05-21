import { useEffect, useState } from "react";
import { api, type Project, type StoryPointIssue, type Team } from "./api";

type Step = "team" | "project" | "issue";

export function SessionWizard() {
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

  return (
    <section className="wizard">
      <Breadcrumbs
        step={step}
        team={team}
        project={project}
        onBackToTeam={goBackToTeam}
        onBackToProject={goBackToProject}
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
          onRetry={() => project && pickProject(project)}
        />
      )}
    </section>
  );
}

function Breadcrumbs(props: {
  step: Step;
  team: Team | null;
  project: Project | null;
  onBackToTeam: () => void;
  onBackToProject: () => void;
}) {
  return (
    <nav className="crumbs">
      <button
        className="crumb"
        disabled={props.step === "team"}
        onClick={props.onBackToTeam}
      >
        1. Team
      </button>
      <span className="crumb-sep">›</span>
      <button
        className="crumb"
        disabled={!props.team || props.step === "project"}
        onClick={props.onBackToProject}
      >
        2. Project {props.team && <em>({props.team.key})</em>}
      </button>
      <span className="crumb-sep">›</span>
      <span className={`crumb ${props.step === "issue" ? "current" : "muted"}`}>
        3. Issue {props.project && <em>({props.project.name})</em>}
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
  onRetry,
}: {
  issue: StoryPointIssue | null;
  project: Project | null;
  labelName: string;
  loaded: boolean;
  onRetry: () => void;
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
      <p className="muted">
        Session creation arrives in v0.2 PR②. For now this confirms the issue
        detection works end-to-end.
      </p>
    </div>
  );
}
