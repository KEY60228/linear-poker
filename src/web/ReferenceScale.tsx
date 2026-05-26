import { useEffect, useState } from "react";
import { api, type Team } from "./api";
import { ReferenceList } from "./ReferenceList";

const SELECTED_TEAM_KEY = "linear-poker:references-team";

export function ReferenceScale() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [labelName] = useState<string>("story-point");
  const [error, setError] = useState<string | null>(null);

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
    if (teamId) sessionStorage.setItem(SELECTED_TEAM_KEY, teamId);
  }, [teamId]);

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
      {teamId && <ReferenceList teamId={teamId} />}
    </section>
  );
}
