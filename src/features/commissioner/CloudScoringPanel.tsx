import { useEffect, useMemo, useState } from "react";
import { NFL_2026_TEAMS } from "../../data/nfl2026";
import { calculateCloudResolutionPreview } from "../../services/cloudScoringService";
import type {
  CloudResolutionPreview,
  CloudRole,
  CloudScoringState,
  CloudTeamScore,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function cleanProviderDetail(value: string | undefined): string {
  return (value ?? "")
    .replace(/\bSTATUS_[A-Z0-9_]+\b/g, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

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
  currentRole,
}: {
  scoring: CloudScoringState;
  onPoolRefresh: () => Promise<void>;
  currentRole: CloudRole;
}) {
  const [draftScores, setDraftScores] = useState<CloudTeamScore[]>(
    scoring.scores,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [finalizePhrase, setFinalizePhrase] = useState("");
  const [reopenPhrase, setReopenPhrase] = useState("");
  const isPrimary = currentRole === "primary_commissioner";

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

  const playingScores = draftScores.filter(
    (score) => score.status !== "bye",
  );
  const finalScoreCount = playingScores.filter(
    (score) => score.status === "final",
  ).length;
  const manualOverrideCount = playingScores.filter(
    (score) => score.source === "manual",
  ).length;
  const exceptionCount = playingScores.filter(
    (score) =>
      score.status === "postponed" ||
      score.status === "canceled",
  ).length;
  const finalizeCommand =
    `FINALIZE WEEK ${scoring.selectedWeek}`;
  const reopenCommand =
    `REOPEN WEEK ${scoring.selectedWeek}`;
  const finalizeAuthorized =
    isPrimary &&
    finalizePhrase.trim().toUpperCase() === finalizeCommand;
  const reopenAuthorized =
    isPrimary &&
    reopenPhrase.trim().toUpperCase() === reopenCommand;

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
              source: "manual",
              event_id: null,
              kickoff_at: row.kickoff_at,
              status_detail:
                nextScore !== null && Number.isFinite(nextScore)
                  ? "Manual commissioner override"
                  : "Manual score cleared",
              synced_at: new Date().toISOString(),
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

  const syncScores = () =>
    run(
      async () => {
        const summary = await scoring.syncFromProvider(
          scoring.selectedWeek,
        );
        setDraftScores(scoring.scores);
        return void summary;
      },
      `Week ${scoring.selectedWeek} NFL schedule and scores synced.`,
    );

  const save = () =>
    run(
      () =>
        scoring.saveScores(scoring.selectedWeek, draftScores),
      `Week ${scoring.selectedWeek} scores saved to Firebase.`,
    );

  const finalize = async () => {
    if (!finalizeAuthorized) {
      setError(`Type ${finalizeCommand} exactly before finalizing.`);
      return;
    }

    await run(async () => {
      await scoring.saveScores(
        scoring.selectedWeek,
        draftScores,
      );
      await scoring.finalizeWeek(scoring.selectedWeek);
      setFinalizePhrase("");
      await onPoolRefresh();
    }, `Week ${scoring.selectedWeek} finalized with a permanent audit snapshot.`);
  };

  const reopen = async () => {
    if (!reopenAuthorized) {
      setError(`Type ${reopenCommand} exactly before reopening.`);
      return;
    }

    await run(
      async () => {
        await scoring.reopenWeek(scoring.selectedWeek);
        setReopenPhrase("");
        await onPoolRefresh();
      },
      `Week ${scoring.selectedWeek} reopened. The prior result remains preserved in the audit archive.`,
    );
  };

  return (
    <section className="section-card cloud-scoring-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 15</p>
          <h2>Final Week Controls and Winner Safeguards</h2>
          <p>
            Commissioners may prepare and sync scores. Only the Primary Commissioner
            can finalize, reopen, or mark a winner paid.
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

      <div className="nfl-sync-card">
        <div>
          <small>NFL scoreboard connection</small>
          <strong>
            {scoring.providerLoading
              ? "Refreshing…"
              : scoring.providerSummary
                ? "Connected"
                : "Waiting for first refresh"}
          </strong>
          <span>
            Automatic refresh every 2 minutes while this app is open.
          </span>
        </div>
        <div className="nfl-sync-counts">
          <span>{scoring.providerSummary?.event_count ?? 0} games</span>
          <span>{scoring.providerSummary?.live_team_count ?? 0} live teams</span>
          <span>{scoring.providerSummary?.final_team_count ?? 0} final teams</span>
        </div>
        <button
          disabled={busy || scoring.providerLoading || Boolean(scoring.result)}
          onClick={() => void syncScores()}
          type="button"
        >
          Sync NFL Scores Now
        </button>
        {scoring.providerSummary && (
          <small className="nfl-sync-time">
            Last update: {new Date(scoring.providerSummary.fetched_at).toLocaleString()}
          </small>
        )}
        {scoring.providerError && (
          <div className="generator-message error">
            {scoring.providerError} Manual entry remains available.
          </div>
        )}
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
                    {isBye
                      ? "Official NFL bye"
                      : row?.source === "manual"
                        ? "Manual commissioner override"
                        : row?.status === "live"
                          ? `LIVE · ${cleanProviderDetail(row.status_detail)}`
                          : row?.status === "final"
                            ? "Final NFL score"
                            : row?.status === "postponed"
                              ? `Postponed · ${cleanProviderDetail(row.status_detail)}`
                              : row?.status === "canceled"
                                ? "Canceled"
                                : cleanProviderDetail(row?.status_detail) || "Scheduled"}
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

      <div className="week-finalization-guard">
        <div className="week-finalization-heading">
          <div>
            <small>Official resolution safeguard</small>
            <strong>
              Week {scoring.selectedWeek} finalization checklist
            </strong>
          </div>
          <span className={preview.can_finalize ? "ready" : "blocked"}>
            {preview.can_finalize ? "Scores ready" : "Blocked"}
          </span>
        </div>

        <div className="week-finalization-checks">
          <article className={
            scoring.selectedWeek === scoring.currentWeek
              ? "passed"
              : "failed"
          }>
            <span>
              {scoring.selectedWeek === scoring.currentWeek ? "✓" : "!"}
            </span>
            <div>
              <strong>Current pool week</strong>
              <small>
                Pool is currently on Week {scoring.currentWeek}.
              </small>
            </div>
          </article>
          <article className={preview.all_players_claimed ? "passed" : "failed"}>
            <span>{preview.all_players_claimed ? "✓" : "!"}</span>
            <div>
              <strong>All schedule numbers claimed</strong>
              <small>{preview.claimed_count} of 32 claims found.</small>
            </div>
          </article>
          <article className={preview.complete_scores ? "passed" : "failed"}>
            <span>{preview.complete_scores ? "✓" : "!"}</span>
            <div>
              <strong>Every playing team is final</strong>
              <small>
                {finalScoreCount} final team scores · {exceptionCount} exceptions.
              </small>
            </div>
          </article>
          <article className={isPrimary ? "passed" : "failed"}>
            <span>{isPrimary ? "✓" : "!"}</span>
            <div>
              <strong>Primary Commissioner approval</strong>
              <small>
                {isPrimary
                  ? "Jimbo is authorized for irreversible controls."
                  : "Backup commissioners can prepare scores but cannot finalize."}
              </small>
            </div>
          </article>
        </div>

        <div className="week-finalization-summary">
          <div>
            <span>Resolution</span>
            <strong>
              {preview.resolution_type === "exact_33"
                ? "Exact 33"
                : preview.resolution_type === "closest_33"
                  ? "Week 18 closest to 33"
                  : "Carryover"}
            </strong>
          </div>
          <div>
            <span>Winners</span>
            <strong>{preview.winners.length}</strong>
          </div>
          <div>
            <span>Official pot</span>
            <strong>{dollars(preview.total_pot_cents)}</strong>
          </div>
          <div>
            <span>Manual overrides</span>
            <strong>{manualOverrideCount}</strong>
          </div>
        </div>

        {!scoring.result && (
          <label className="week-confirmation-field">
            <span>
              Type <strong>{finalizeCommand}</strong> to unlock finalization.
            </span>
            <input
              autoComplete="off"
              disabled={!isPrimary || busy}
              onChange={(event) =>
                setFinalizePhrase(event.target.value)
              }
              placeholder={finalizeCommand}
              type="text"
              value={finalizePhrase}
            />
          </label>
        )}

        {scoring.result && (
          <label className="week-confirmation-field reopen">
            <span>
              Type <strong>{reopenCommand}</strong> to reverse the latest result.
            </span>
            <input
              autoComplete="off"
              disabled={!isPrimary || busy}
              onChange={(event) =>
                setReopenPhrase(event.target.value)
              }
              placeholder={reopenCommand}
              type="text"
              value={reopenPhrase}
            />
          </label>
        )}

        <p className="week-finalization-note">
          Finalization stores a permanent snapshot of scores, schedule
          assignments, pot calculations, winners, and a resolution fingerprint.
        </p>
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
                !isPrimary ||
                !finalizeAuthorized ||
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
            disabled={busy || !isPrimary || !reopenAuthorized}
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
                  busy ||
                  !isPrimary ||
                  winner.payout_status === "paid"
                }
                onClick={() => {
                  const approved = window.confirm(
                    `Confirm ${dollars(winner.payout_cents)} was actually paid to ${winner.player_name} for Week ${winner.week}.`,
                  );

                  if (!approved) {
                    return;
                  }

                  void run(
                    () => scoring.markWinnerPaid(winner.id),
                    `${winner.player_name}'s prize marked paid.`,
                  );
                }}
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

      {!isPrimary && (
        <div className="generator-message">
          Backup commissioners may sync and save score corrections.
          Finalize, reopen, and prize-paid controls require Jimbo.
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
