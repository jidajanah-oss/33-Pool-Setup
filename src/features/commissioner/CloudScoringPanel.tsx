import { useEffect, useMemo, useState } from "react";
import { NFL_2026_TEAMS } from "../../data/nfl2026";
import { calculateCloudResolutionPreview } from "../../services/cloudScoringService";
import type {
  CloudResolutionPreview,
  CloudScoringState,
  CloudTeamScore,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function dollars(cents: number): string {
  return currency.format(cents / 100);
}

function description(preview: CloudResolutionPreview): string {
  if (!preview.complete_scores) {
    return "Enter and save every playing team's final score.";
  }

  if (preview.resolution_type === "exact_33") {
    return preview.winners.length === 1
      ? "One assigned team finished with exactly 33."
      : `${preview.winners.length} assigned teams finished with exactly 33 and split the pot.`;
  }

  if (preview.resolution_type === "closest_33") {
    return preview.winners.length === 1
      ? "No Week 18 team scored 33. The closest final score wins."
      : `No Week 18 team scored 33. ${preview.winners.length} equally close teams split the pot.`;
  }

  return "No assigned team finished with 33. The full pot carries forward.";
}

export function CloudScoringPanel({
  scoring,
  onPoolRefresh,
}: {
  scoring: CloudScoringState;
  onPoolRefresh: () => Promise<void>;
}) {
  const [draftScores, setDraftScores] = useState<CloudTeamScore[]>(
    scoring.scores,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraftScores(scoring.scores);
  }, [scoring.scores, scoring.selectedWeek]);

  const preview = useMemo(
    () =>
      calculateCloudResolutionPreview(
        scoring.selectedWeek,
        draftScores,
        scoring.assignments,
        scoring.history,
      ),
    [
      draftScores,
      scoring.assignments,
      scoring.history,
      scoring.selectedWeek,
    ],
  );

  const changeScore = (teamCode: string, value: string) => {
    const nextScore =
      value.trim() === "" ? null : Number.parseInt(value, 10);

    setDraftScores((current) =>
      current.map((row) =>
        row.team_code === teamCode
          ? {
              ...row,
              score:
                nextScore !== null && Number.isFinite(nextScore)
                  ? nextScore
                  : null,
              status:
                nextScore !== null && Number.isFinite(nextScore)
                  ? "final"
                  : "not_started",
            }
          : row,
      ),
    );
  };

  const run = async (
    action: () => Promise<void>,
    success: string,
  ) => {
    setBusy(true);
    setMessage("");
    setError("");

    try {
      await action();
      setMessage(success);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Firebase scoring action failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(
      () =>
        scoring.saveScores(scoring.selectedWeek, draftScores),
      `Week ${scoring.selectedWeek} scores saved to Firebase.`,
    );

  const finalize = async () => {
    if (
      !window.confirm(
        `Finalize Week ${scoring.selectedWeek}? This calculates the official pot, winner records, and next-week carryover.`,
      )
    ) {
      return;
    }

    await run(async () => {
      await scoring.saveScores(
        scoring.selectedWeek,
        draftScores,
      );
      await scoring.finalizeWeek(scoring.selectedWeek);
      await onPoolRefresh();
    }, `Week ${scoring.selectedWeek} finalized.`);
  };

  const reopen = async () => {
    if (
      !window.confirm(
        `Reopen Week ${scoring.selectedWeek}? Winner earnings will be reversed until the week is finalized again.`,
      )
    ) {
      return;
    }

    await run(
      async () => {
        await scoring.reopenWeek(scoring.selectedWeek);
        await onPoolRefresh();
      },
      `Week ${scoring.selectedWeek} reopened.`,
    );
  };

  return (
    <section className="section-card cloud-scoring-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 7</p>
          <h2>NFL Final Scores and Pot Resolution</h2>
          <p>
            Enter each team&apos;s final score. Teams on their official
            NFL bye are disabled automatically.
          </p>
        </div>
        <span
          className={`generator-status ${
            scoring.result ? "locked" : ""
          }`}
        >
          {scoring.result
            ? `Week ${scoring.selectedWeek} finalized`
            : `Week ${scoring.selectedWeek} draft`}
        </span>
      </div>

      <div className="week-selector scoring-week-selector">
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
      </div>

      <div className="cloud-score-grid">
        {NFL_2026_TEAMS.map((team) => {
          const row = draftScores.find(
            (score) => score.team_code === team.code,
          );
          const isBye = team.byeWeek === scoring.selectedWeek;

          return (
            <label
              className={`cloud-score-card ${
                isBye ? "bye" : ""
              }`}
              key={team.code}
            >
              <div>
                <span className="team-code-box small">
                  {team.code}
                </span>
                <div>
                  <strong>{team.name}</strong>
                  <small>
                    {isBye ? "Official NFL bye" : "Final score"}
                  </small>
                </div>
              </div>
              {isBye ? (
                <span className="pill bye">BYE</span>
              ) : (
                <input
                  aria-label={`${team.name} final score`}
                  disabled={busy || Boolean(scoring.result)}
                  inputMode="numeric"
                  max="99"
                  min="0"
                  onChange={(event) =>
                    changeScore(team.code, event.target.value)
                  }
                  placeholder="—"
                  type="number"
                  value={row?.score ?? ""}
                />
              )}
            </label>
          );
        })}
      </div>

      <div className="scoring-preview-card">
        <div className="scoring-preview-money">
          <div>
            <small>Carryover in</small>
            <strong>{dollars(preview.carryover_in_cents)}</strong>
          </div>
          <div>
            <small>Weekly addition</small>
            <strong>$96.00</strong>
          </div>
          <div>
            <small>Total pot</small>
            <strong>{dollars(preview.total_pot_cents)}</strong>
          </div>
          <div>
            <small>Carryover out</small>
            <strong>
              {dollars(preview.carryover_out_cents)}
            </strong>
          </div>
        </div>

        <h3>{description(preview)}</h3>

        {preview.winners.length > 0 && (
          <div className="scoring-preview-winners">
            {preview.winners.map((winner) => (
              <article key={winner.schedule_number}>
                <span className="team-code-box small">
                  {winner.team_code}
                </span>
                <div>
                  <strong>{winner.player_name}</strong>
                  <small>
                    Schedule #{winner.schedule_number} ·{" "}
                    {winner.final_score} points
                  </small>
                </div>
                <strong>{dollars(winner.payout_cents)}</strong>
              </article>
            ))}
          </div>
        )}

        {preview.blocking_reasons.length > 0 && (
          <div className="scoring-blockers">
            {preview.blocking_reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        )}
      </div>

      <div className="cloud-score-actions">
        {!scoring.result && (
          <>
            <button
              disabled={busy}
              onClick={() => void save()}
              type="button"
            >
              Save Draft Scores
            </button>
            <button
              className="generator-primary"
              disabled={
                busy ||
                scoring.selectedWeek !== scoring.currentWeek ||
                !preview.can_finalize
              }
              onClick={() => void finalize()}
              type="button"
            >
              Finalize Week {scoring.selectedWeek}
            </button>
          </>
        )}

        {scoring.result && (
          <button
            className="scoring-reopen-button"
            disabled={busy}
            onClick={() => void reopen()}
            type="button"
          >
            Reopen Latest Finalized Week
          </button>
        )}

        <button
          disabled={busy || scoring.loading}
          onClick={() => void scoring.refresh()}
          type="button"
        >
          Refresh Scoring
        </button>
      </div>

      {scoring.winners.length > 0 && (
        <div className="commissioner-winner-list">
          <h3>Winner Payout Records</h3>
          {scoring.winners.map((winner) => (
            <article key={winner.id}>
              <div>
                <strong>{winner.player_name}</strong>
                <span>
                  Schedule #{winner.schedule_number} ·{" "}
                  {winner.team_code} scored {winner.final_score}
                </span>
              </div>
              <div>
                <strong>{dollars(winner.payout_cents)}</strong>
                <span>{winner.payout_status.replace("_", " ")}</span>
              </div>
              <button
                disabled={
                  busy || winner.payout_status === "paid"
                }
                onClick={() =>
                  void run(
                    () => scoring.markWinnerPaid(winner.id),
                    `${winner.player_name}'s prize marked paid.`,
                  )
                }
                type="button"
              >
                {winner.payout_status === "paid"
                  ? "Paid"
                  : "Mark Paid"}
              </button>
            </article>
          ))}
        </div>
      )}

      {message && (
        <div className="generator-message">{message}</div>
      )}
      {(error || scoring.error) && (
        <div className="generator-message error">
          {error || scoring.error}
        </div>
      )}
    </section>
  );
}
