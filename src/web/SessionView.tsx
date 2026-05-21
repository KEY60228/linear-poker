import { useEffect, useState } from "react";
import {
  api,
  NEED_INFO,
  type ParticipantState,
  type SessionState,
  type User,
  type Viewer,
} from "./api";

const POLL_INTERVAL_MS = 3000;

export function SessionView({
  sessionId,
  viewer,
}: {
  sessionId: string;
  viewer: Viewer | null;
}) {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const next = await api.getSession(sessionId);
        if (!cancelled) {
          setState(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (!state) {
    return (
      <section>
        {error && <p className="error">Error: {error}</p>}
        {!error && <p>Loading session…</p>}
      </section>
    );
  }

  const me = state.participants.find((p) => p.userId === viewer?.id) ?? null;
  const isParticipant = !!me;

  async function vote(value: string) {
    setVoting(true);
    setError(null);
    try {
      await api.vote(sessionId, value);
      const fresh = await api.getSession(sessionId);
      setState(fresh);
    } catch (e) {
      setError(String(e));
    } finally {
      setVoting(false);
    }
  }

  async function reveal() {
    try {
      await api.reveal(sessionId);
      const fresh = await api.getSession(sessionId);
      setState(fresh);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="session">
      <Header state={state} />
      {error && <p className="error">Error: {error}</p>}
      <ParticipantList participants={state.participants} status={state.status} viewerId={viewer?.id ?? null} />
      <ParticipantManager
        sessionId={sessionId}
        participants={state.participants}
        teamId={state.meta.team.id}
        onChanged={async () => {
          try {
            setState(await api.getSession(sessionId));
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      {state.status === "voting" && isParticipant && (
        <VotePad
          state={state}
          myVote={me?.voted ? (me.votedNeedInfo ? NEED_INFO : "voted") : null}
          disabled={voting}
          onVote={vote}
        />
      )}
      {state.status === "voting" && state.needsDiscussion && (
        <div className="callout warning">
          <h3>Needs discussion</h3>
          <p>
            At least one participant voted <code>need_info</code>. Auto-reveal is
            paused. They can change their vote, or anyone can press reveal below
            to escape and discuss what's known so far.
          </p>
          <button onClick={reveal}>Reveal now</button>
        </div>
      )}
      {state.status === "revealed" && <RevealedView state={state} />}
    </section>
  );
}

function Header({ state }: { state: SessionState }) {
  const { meta, status, currentRoundNo } = state;
  return (
    <header className="session-header">
      <div>
        <h2>
          <a href={meta.issue.url} target="_blank" rel="noreferrer">
            {meta.issue.identifier}
          </a>{" "}
          {meta.issue.title}
        </h2>
        <p className="muted">
          {meta.team.key} ·{" "}
          <a href={meta.project.url} target="_blank" rel="noreferrer">
            {meta.project.name}
          </a>{" "}
          · round #{currentRoundNo}
        </p>
      </div>
      <span className={`badge badge-${status}`}>{status}</span>
    </header>
  );
}

function ParticipantList({
  participants,
  status,
  viewerId,
}: {
  participants: ParticipantState[];
  status: SessionState["status"];
  viewerId: string | null;
}) {
  return (
    <ul className="participants-list">
      {participants.map((p) => {
        const me = p.userId === viewerId;
        return (
          <li key={p.userId} className={me ? "me" : ""}>
            <span className="name">
              {p.displayName}
              {me && <em className="muted"> (you)</em>}
            </span>
            <span className="vote-status">
              {status === "voting" &&
                (p.voted
                  ? p.votedNeedInfo
                    ? <span className="tag tag-info">need_info</span>
                    : <span className="tag tag-ok">voted</span>
                  : <span className="tag tag-pending">pending</span>)}
              {status !== "voting" && (
                p.value === null
                  ? <span className="tag tag-pending">no vote</span>
                  : p.value === NEED_INFO
                    ? <span className="tag tag-info">need_info</span>
                    : <span className="tag tag-value">{p.value}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function VotePad({
  state,
  myVote,
  disabled,
  onVote,
}: {
  state: SessionState;
  myVote: string | null;
  disabled: boolean;
  onVote: (value: string) => void;
}) {
  return (
    <div className="votepad">
      <h3>Your vote {myVote && <em className="muted">(submitted — pick again to change)</em>}</h3>
      <div className="vote-buttons">
        {state.meta.scale.options.map((opt) => (
          <button
            key={opt.value}
            disabled={disabled}
            className="vote-button"
            onClick={() => onVote(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <button
          disabled={disabled}
          className="vote-button vote-need-info"
          onClick={() => onVote(NEED_INFO)}
        >
          need_info
        </button>
      </div>
    </div>
  );
}

function RevealedView({ state }: { state: SessionState }) {
  const numeric = state.participants
    .map((p) => p.value)
    .filter((v): v is string => v !== null && v !== NEED_INFO)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));

  const needInfoCount = state.participants.filter(
    (p) => p.value === NEED_INFO,
  ).length;

  return (
    <div className="callout">
      <h3>Revealed</h3>
      {numeric.length > 0 && (
        <p className="muted">
          {numeric.length} numeric vote(s) · min {Math.min(...numeric)} · max{" "}
          {Math.max(...numeric)}
        </p>
      )}
      {needInfoCount > 0 && (
        <p className="muted">{needInfoCount} need_info vote(s)</p>
      )}
      <p className="muted">
        Stats (median / mode / mean), finalize → Linear, and re-vote arrive in v0.3.
      </p>
    </div>
  );
}

function ParticipantManager({
  sessionId,
  participants,
  teamId,
  onChanged,
}: {
  sessionId: string;
  participants: ParticipantState[];
  teamId: string;
  onChanged: () => Promise<void>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[] | null>(null);
  const [members, setMembers] = useState<User[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!showPicker) return;
    api.teamMembers(teamId).then(setMembers).catch(() => undefined);
  }, [showPicker, teamId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchUsers(q).then((u) => !cancelled && setResults(u)).catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const partIds = new Set(participants.map((p) => p.userId));
  const base = members ?? [];
  const seen = new Set(base.map((u) => u.id));
  const candidates: User[] = results
    ? [...base, ...results.filter((u) => !seen.has(u.id))]
    : base;
  const candidatesToAdd = candidates.filter((u) => !partIds.has(u.id));

  async function add(userId: string) {
    setBusy(true);
    try {
      await api.addParticipant(sessionId, userId);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    setBusy(true);
    try {
      await api.removeParticipant(sessionId, userId);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="manage-participants" open={showPicker} onToggle={(e) => setShowPicker((e.target as HTMLDetailsElement).open)}>
      <summary>Manage participants</summary>
      <div className="manage-body">
        <p className="muted">Remove anyone here, or search to add more.</p>
        <ul className="list">
          {participants.map((p) => (
            <li key={p.userId} className="row-static">
              <span>{p.displayName}</span>
              <em className="muted">{p.email}</em>
              <button disabled={busy} onClick={() => remove(p.userId)}>Remove</button>
            </li>
          ))}
        </ul>
        <input
          className="search"
          type="search"
          placeholder="Search workspace users…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {candidatesToAdd.length > 0 && (
          <ul className="list">
            {candidatesToAdd.map((u) => (
              <li key={u.id} className="row-static">
                <span>{u.displayName}</span>
                <em className="muted">{u.email}</em>
                <button disabled={busy} onClick={() => add(u.id)}>Add</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
