import { useEffect, useMemo, useState } from "react";
import {
  api,
  NEED_INFO,
  type ParticipantState,
  type ScaleOption,
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

  async function refresh() {
    try {
      setState(await api.getSession(sessionId));
    } catch (e) {
      setError(String(e));
    }
  }

  async function reveal() {
    try {
      await api.reveal(sessionId);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function finalize(value: string) {
    try {
      await api.finalize(sessionId, value);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function revote() {
    try {
      await api.revote(sessionId);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function unfinalize() {
    if (
      !window.confirm(
        "確定を取り消しますか？\n\nこの操作はアプリ内の記録だけを取り消します。Linear 側に書き戻した Estimate と Project status は元に戻りません。Linear 側で既に値が revert されているケースで、アプリ側の状態を追従させたい時に使ってください。",
      )
    ) {
      return;
    }
    try {
      await api.unfinalize(sessionId);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="session">
      <Header state={state} />
      {error && <p className="error">Error: {error}</p>}
      <ParticipantList participants={state.participants} status={state.status} viewerId={viewer?.id ?? null} />
      {state.status === "voting" && (
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
      )}
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
      {state.status === "revealed" && (
        <RevealedView state={state} onFinalize={finalize} onRevote={revote} />
      )}
      {state.status === "finalized" && (
        <FinalizedView state={state} onUnfinalize={unfinalize} />
      )}
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

type Stats = {
  count: number;
  needInfo: number;
  median: number | null;
  mode: number[] | null;
  mean: number | null;
  min: number | null;
  max: number | null;
};

function computeStats(participants: ParticipantState[]): Stats {
  const numeric = participants
    .map((p) => p.value)
    .filter((v): v is string => v !== null && v !== NEED_INFO)
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
  const needInfo = participants.filter((p) => p.value === NEED_INFO).length;
  if (numeric.length === 0) {
    return { count: 0, needInfo, median: null, mode: null, mean: null, min: null, max: null };
  }
  const sorted = [...numeric].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : sorted[mid] ?? 0;
  const counts = new Map<number, number>();
  for (const n of numeric) counts.set(n, (counts.get(n) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const mode =
    maxCount === 1
      ? null
      : [...counts.entries()]
          .filter(([, c]) => c === maxCount)
          .map(([n]) => n)
          .sort((a, b) => a - b);
  const mean = numeric.reduce((s, n) => s + n, 0) / numeric.length;
  return {
    count: numeric.length,
    needInfo,
    median,
    mode,
    mean,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

function snapToScale(target: number, options: ScaleOption[]): string | null {
  if (options.length === 0) return null;
  let best = options[0]!;
  let bestDist = Math.abs(Number(best.value) - target);
  for (const opt of options.slice(1)) {
    const d = Math.abs(Number(opt.value) - target);
    if (d < bestDist) {
      bestDist = d;
      best = opt;
    }
  }
  return best.value;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function RevealedView({
  state,
  onFinalize,
  onRevote,
}: {
  state: SessionState;
  onFinalize: (value: string) => Promise<void>;
  onRevote: () => Promise<void>;
}) {
  const stats = useMemo(() => computeStats(state.participants), [state.participants]);
  const suggested = stats.median !== null
    ? snapToScale(stats.median, state.meta.scale.options)
    : null;
  const [selected, setSelected] = useState<string | null>(suggested);
  const [busy, setBusy] = useState(false);

  // Re-sync the default when the underlying suggestion changes (e.g. after a
  // participant edit between rounds).
  useEffect(() => {
    if (selected === null && suggested !== null) setSelected(suggested);
  }, [suggested, selected]);

  const hasNeedInfo = stats.needInfo > 0;

  async function confirmFinalize() {
    if (!selected) return;
    setBusy(true);
    try {
      await onFinalize(selected);
    } finally {
      setBusy(false);
    }
  }

  async function clickRevote() {
    setBusy(true);
    try {
      await onRevote();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="callout revealed">
      <h3>Revealed</h3>
      {stats.count > 0 ? (
        <dl className="stats">
          <Stat label="median" value={fmt(stats.median!)} />
          <Stat label="mean" value={fmt(stats.mean!)} />
          <Stat
            label="mode"
            value={stats.mode ? stats.mode.map(fmt).join(", ") : "—"}
          />
          <Stat label="range" value={`${fmt(stats.min!)} – ${fmt(stats.max!)}`} />
          <Stat label="votes" value={String(stats.count)} />
        </dl>
      ) : (
        <p className="muted">No numeric votes in this round.</p>
      )}
      {hasNeedInfo && (
        <p className="warning">
          ⚠ {stats.needInfo} participant(s) voted <code>need_info</code>. You can
          still finalize, but consider discussing first.
        </p>
      )}

      <div className="finalize">
        <h4>Confirm estimate</h4>
        <p className="muted">
          Pick the agreed value. The number on the right is the snap-to-scale
          suggestion from the median.
        </p>
        <div className="vote-buttons">
          {state.meta.scale.options.map((opt) => {
            const isSelected = selected === opt.value;
            const isSuggested = suggested === opt.value;
            return (
              <button
                key={opt.value}
                className={`vote-button ${isSelected ? "vote-selected" : ""}`}
                onClick={() => setSelected(opt.value)}
                disabled={busy}
              >
                {opt.label}
                {isSuggested && <span className="badge-suggested">suggested</span>}
              </button>
            );
          })}
        </div>
        <p className="actions">
          <button
            className="primary-button"
            disabled={!selected || busy}
            onClick={confirmFinalize}
          >
            {busy ? "Working…" : `Confirm & write back to Linear`}
          </button>
          <button className="secondary-button" disabled={busy} onClick={clickRevote}>
            Re-vote
          </button>
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FinalizedView({
  state,
  onUnfinalize,
}: {
  state: SessionState;
  onUnfinalize: () => Promise<void>;
}) {
  const fin = state.finalEstimate;
  if (!fin) return null;
  const finalizedBy =
    state.participants.find((p) => p.userId === fin.finalizedBy)?.displayName ??
    fin.finalizedBy;
  const valueLabel =
    state.meta.scale.options.find((o) => o.value === fin.value)?.label ?? fin.value;
  return (
    <div className="callout finalized">
      <h3>Finalized</h3>
      <p className="final-value">
        <span className="final-value-num">{valueLabel}</span>
      </p>
      <p className="muted">
        Written back to Linear ·{" "}
        <a href={state.meta.issue.url} target="_blank" rel="noreferrer">
          {state.meta.issue.identifier}
        </a>{" "}
        · finalized by {finalizedBy} ·{" "}
        {new Date(fin.finalizedAt).toLocaleString()}
      </p>
      <p className="actions">
        <button className="secondary-button" onClick={onUnfinalize}>
          Revert finalization
        </button>
      </p>
      <p className="muted">
        Use this when Linear's estimate or project status has been reverted
        externally. This only updates the local record — Linear is left as-is.
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
