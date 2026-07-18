import { useEffect, useMemo, useState } from "react";
import type {
  CloudEnrollmentState,
  CloudScoringState,
  CloudTeamScore,
  CloudWeeklyRow,
} from "../../types/cloud";

function scoreByTeam(
  scores: readonly CloudTeamScore[],
): Map<string, CloudTeamScore> {
  return new Map(scores.map((score) => [score.team_code, score]));
}

export function CloudWeeklyScoringBoard({
  cloud,
  scoring,
}: {
  cloud: CloudEnrollmentState;
  scoring: CloudScoringState;
}) {
  const [rows, setRows] = useState<CloudWeeklyRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowError, setRowError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingRows(true);
    setRowError("");

    void cloud
      .loadWeeklyBoard(scoring.selectedWeek)
      .then((data) => {
        if (active) {
          setRows(data);
        }
      })
      .catch((caught) => {
        if (active) {
          setRowError(
            caught instanceof Error
              ? caught.message
              : "The weekly board could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingRows(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cloud, scoring.selectedWeek]);

  const scores = useMemo(
    () => scoreByTeam(scoring.scores),
    [scoring.scores],
  );
  const winnerLines = useMemo(
    () =>
      new Set(
        scoring.winners.map((winner) => winner.schedule_number),
      ),
    [scoring.winners],
  );

  return (
    <div className="screen-stack">
      <section className="week-banner">
        <div>
          <small>Firebase weekly scoring</small>
          <strong>Week {scoring.selectedWeek}</strong>
          <span>
            Live NFL scores refresh automatically · opponents are not displayed
          </span>
        </div>
        <div>
          <small>Pot</small>
          <strong>
            ${(scoring.result?.total_pot_cents ??
              scoring.currentPotCents) / 100}
          </strong>
        </div>
      </section>

      <section className="week-selector">
        {Array.from({ length: 18 }, (_, index) => index + 1).map(
          (week) => (
            <button
              className={
                scoring.selectedWeek === week ? "active" : ""
              }
              key={week}
              onClick={() => scoring.setSelectedWeek(week)}
              type="button"
            >
              {week}
            </button>
          ),
        )}
      </section>

      {(loadingRows || scoring.loading) && (
        <section className="info-banner">
          Loading Week {scoring.selectedWeek} assignments and scores…
        </section>
      )}

      {(rowError || scoring.error) && (
        <section className="generator-error">
          {rowError || scoring.error}
        </section>
      )}

      <section className="weekly-live-status">
        <span>
          {scoring.providerLoading
            ? "Refreshing NFL scoreboard…"
            : scoring.providerSummary
              ? `NFL scoreboard updated ${new Date(
                  scoring.providerSummary.fetched_at,
                ).toLocaleTimeString()}`
              : "NFL scoreboard update pending"}
        </span>
        <button
          disabled={scoring.providerLoading}
          onClick={() => void scoring.refresh()}
          type="button"
        >
          Refresh
        </button>
      </section>

      <section className="assignment-list">
        {rows.map((row) => {
          const score = row.team_code
            ? scores.get(row.team_code)
            : undefined;
          const isWinner = winnerLines.has(row.schedule_number);
          const isCurrentlyAt33 =
            score?.status === "final" && score.score === 33;

          return (
            <article
              className={`assignment-row ${
                row.mine ? "mine" : ""
              } ${isWinner ? "winner-row" : ""}`}
              key={row.schedule_number}
            >
              <div className="assignment-number">
                #{row.schedule_number}
              </div>
              <div
                className={`team-code-box small ${
                  row.team_code ? "" : "hidden-team"
                }`}
              >
                {row.team_code ?? "?"}
              </div>
              <div className="assignment-copy">
                <strong>{row.player_name ?? "Available"}</strong>
                <span>
                  {row.team_name ?? "Schedule remains hidden"}
                </span>
              </div>
              <div className="assignment-score">
                {row.is_bye ? (
                  <span className="pill bye">BYE</span>
                ) : score?.status === "final" ? (
                  <>
                    <strong>{score.score}</strong>
                    <small>
                      {isWinner
                        ? "WINNER"
                        : isCurrentlyAt33
                          ? "FINAL 33"
                          : "FINAL"}
                    </small>
                  </>
                ) : score?.status === "live" ? (
                  <>
                    <strong>{score.score ?? 0}</strong>
                    <small>{score.score === 33 ? "AT 33" : "LIVE"}</small>
                  </>
                ) : score?.status === "postponed" ? (
                  <span className="score-exception">POSTPONED</span>
                ) : score?.status === "canceled" ? (
                  <span className="score-exception">CANCELED</span>
                ) : (
                  <span>{row.player_name ? "UPCOMING" : "OPEN"}</span>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
