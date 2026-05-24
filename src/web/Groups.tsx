import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ParticipantGroup,
  type ParticipantGroupMember,
  type Team,
  type User,
} from "./api";

const SELECTED_TEAM_KEY = "linear-poker:groups-team";

type EditorState =
  | { mode: "closed" }
  | { mode: "new" }
  | { mode: "edit"; group: ParticipantGroup };

export function Groups() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ParticipantGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });

  useEffect(() => {
    api
      .teams()
      .then((ts) => {
        setTeams(ts);
        const remembered = sessionStorage.getItem(SELECTED_TEAM_KEY);
        const initial =
          (remembered && ts.find((t) => t.id === remembered)?.id) ?? ts[0]?.id ?? null;
        setTeamId(initial);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    sessionStorage.setItem(SELECTED_TEAM_KEY, teamId);
    setGroups(null);
    setError(null);
    api.listGroups(teamId).then(setGroups).catch((e) => setError(String(e)));
  }, [teamId]);

  async function refresh() {
    if (!teamId) return;
    setGroups(await api.listGroups(teamId));
  }

  async function remove(g: ParticipantGroup) {
    if (!window.confirm(`グループ「${g.name}」を削除しますか？`)) return;
    try {
      await api.deleteGroup(g.id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="groups">
      <header className="references-header">
        <div>
          <h2>Participant groups</h2>
          <p className="muted">
            Save common rosters (e.g. dev team) so you can apply them to a new
            session in one click. Groups are Team-scoped and editable by
            anyone.
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

      <p className="actions">
        <button
          className="primary-button"
          onClick={() => setEditor({ mode: "new" })}
          disabled={!teamId}
        >
          + New group
        </button>
      </p>

      {groups === null && <p>Loading…</p>}
      {groups !== null && groups.length === 0 && (
        <p className="muted">No groups in this team yet.</p>
      )}
      {groups && groups.length > 0 && (
        <ul className="list">
          {groups.map((g) => (
            <li key={g.id}>
              <div className="row row-static group-row">
                <span className="group-name">
                  <strong>{g.name}</strong>
                  <em className="muted"> · {g.members.length} member(s)</em>
                </span>
                <span className="group-actions">
                  <button onClick={() => setEditor({ mode: "edit", group: g })}>
                    Edit
                  </button>
                  <button onClick={() => remove(g)}>Delete</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor.mode !== "closed" && teamId && (
        <GroupEditor
          teamId={teamId}
          existing={editor.mode === "edit" ? editor.group : null}
          onClose={() => setEditor({ mode: "closed" })}
          onSaved={async () => {
            setEditor({ mode: "closed" });
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function GroupEditor({
  teamId,
  existing,
  onClose,
  onSaved,
}: {
  teamId: string;
  existing: ParticipantGroup | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const initialMap = useMemo(() => {
    const m = new Map<string, ParticipantGroupMember>();
    for (const mem of existing?.members ?? []) m.set(mem.userId, mem);
    return m;
  }, [existing]);
  const [selected, setSelected] = useState<Map<string, { userId: string; displayName: string; email: string }>>(initialMap);
  const [members, setMembers] = useState<User[] | null>(null);
  const [searchResults, setSearchResults] = useState<User[] | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.teamMembers(teamId).then(setMembers).catch((e) => setError(String(e)));
  }, [teamId]);

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
        .then((u) => !cancelled && setSearchResults(u))
        .catch(() => undefined);
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
      else
        next.set(u.id, {
          userId: u.id,
          displayName: u.displayName,
          email: u.email,
        });
      return next;
    });
  }

  function removeChip(userId: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }

  async function save() {
    if (!name.trim() || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const userIds = [...selected.keys()];
      if (existing) {
        await api.updateGroup(existing.id, { name: name.trim(), userIds });
      } else {
        await api.createGroup(teamId, { name: name.trim(), userIds });
      }
      await onSaved();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="group-editor callout">
      <h3>{existing ? `Edit group: ${existing.name}` : "New group"}</h3>
      <label className="field">
        <span className="muted">Name</span>
        <input
          className="search"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dev team"
        />
      </label>

      {error && <p className="error">Error: {error}</p>}

      {selected.size > 0 && (
        <div className="chips">
          {[...selected.values()].map((u) => (
            <span key={u.userId} className="chip">
              {u.displayName}
              <button aria-label={`Remove ${u.displayName}`} onClick={() => removeChip(u.userId)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="search"
        type="search"
        placeholder="Search team members or workspace users…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

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
          onClick={save}
          disabled={!name.trim() || selected.size === 0 || saving}
        >
          {saving ? "Saving…" : existing ? "Save changes" : `Create group (${selected.size})`}
        </button>
        <button className="secondary-button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </p>
    </div>
  );
}
