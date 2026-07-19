import { useEffect, useMemo, useState } from "react";
import {
  fetchBackgroundNflSyncStatus,
  runSecureCloudNflSync,
} from "../../services/cloudBackgroundNflSyncService";
import {
  calculateCloudResolutionPreview,
} from "../../services/cloudScoringService";
import type {
  CloudBackgroundNflSyncStatus,
  CloudCommissionerTeamState,
  CloudEnrollmentState,
  CloudPaymentState,
  CloudRole,
  CloudScoringState,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function dollars(cents: number): string {
  return currency.format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Waiting for first cloud run";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

function minutesSince(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000),
  );
}

function scrollToPanel(selector: string): void {
  document.querySelector(selector)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

export function CloudWeeklyOperationsPanel({
  cloud,
  currentRole,
  payments,
  scoring,
  team,
}: {
  cloud: CloudEnrollmentState;
  currentRole: CloudRole;
  payments: CloudPaymentState;
  scoring: CloudScoringState;
  team: CloudCommissionerTeamState;
}) {
  const [background, setBackground] =
    useState<CloudBackgroundNflSyncStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "sync" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const preview = useMemo(
    () =>
      calculateCloudResolutionPreview(
        scoring.currentWeek,
        scoring.scores,
        scoring.assignments,
        scoring.history,
      ),
    [
      scoring.assignments,
      scoring.currentWeek,
      scoring.history,
      scoring.scores,
    ],
  );

  const playingScores = scoring.scores.filter(
    (score) => score.status !== "bye",
  );
  const scheduledCount = playingScores.filter(
    (score) => score.status === "not_started",
  ).length;
  const liveCount = playingScores.filter(
    (score) => score.status === "live",
  ).length;
  const finalCount = playingScores.filter(
    (score) => score.status === "final",
  ).length;
  const exceptionCount = playingScores.filter(
    (score) =>
      score.status === "postponed" ||
      score.status === "canceled",
  ).length;
  const manualOverrideCount = playingScores.filter(
    (score) => score.source === "manual",
  ).length;
  const byeCount = scoring.scores.filter(
    (score) => score.status === "bye",
  ).length;
  const paymentCurrentCount =
    payments.commissionerAccounts.filter(
      (account) => account.payment_status === "current",
    ).length;
  const paymentBehindCount =
    payments.commissionerAccounts.filter(
      (account) => account.payment_status === "behind",
    ).length;
  const pendingWinnerCount = scoring.winners.filter(
    (winner) => winner.payout_status === "pending",
  ).length;
  const heldWinnerCount = scoring.winners.filter(
    (winner) => winner.payout_status === "on_hold",
  ).length;
  const paidWinnerCount = scoring.winners.filter(
    (winner) => winner.payout_status === "paid",
  ).length;
  const isPrimary = currentRole === "primary_commissioner";
  const seasonLaunched =
    cloud.poolStatus?.season_launched === true;
  const syncAgeMinutes = minutesSince(
    background?.completed_at ?? null,
  );
  const syncHealthy =
    background?.outcome === "success" &&
    syncAgeMinutes !== null &&
    syncAgeMinutes <= 30;
  const teamCoverage = Math.max(
    background?.team_count ?? 0,
    scoring.providerSummary?.team_count ?? 0,
    scoring.scores.length,
  );
  const backupsReady = Boolean(
    team.backups.backup1 && team.backups.backup2,
  );
  const lastFinalizedWeek = scoring.history.reduce(
    (latest, result) => Math.max(latest, result.week),
    0,
  );

  const phase = useMemo(() => {
    if (!seasonLaunched) {
      return {
        key: "preseason",
        title: "Preseason setup",
        detail:
          "Finish onboarding, close number selection, and complete the Season Launch checklist.",
      };
    }

    if (scoring.currentWeek === 18 && scoring.result) {
      return {
        key: "complete",
        title: "Season complete",
        detail:
          "Week 18 is finalized. Review prize payments and keep the final backup.",
      };
    }

    if (liveCount > 0) {
      return {
        key: "live",
        title: "Games in progress",
        detail:
          `${liveCount} NFL team result${liveCount === 1 ? " is" : "s are"} live.`,
      };
    }

    if (
      finalCount === playingScores.length &&
      playingScores.length > 0 &&
      preview.can_finalize
    ) {
      return {
        key: "ready",
        title: "Ready to finalize",
        detail:
          `All playing teams are final. Jimbo can finalize Week ${scoring.currentWeek}.`,
      };
    }

    if (exceptionCount > 0) {
      return {
        key: "attention",
        title: "Exception review required",
        detail:
          `${exceptionCount} postponed or canceled team result${
            exceptionCount === 1 ? " needs" : "s need"
          } commissioner review.`,
      };
    }

    if (scheduledCount > 0) {
      return {
        key: "waiting",
        title: "Awaiting NFL games",
        detail:
          `${scheduledCount} team result${
            scheduledCount === 1 ? " has" : "s have"
          } not started.`,
      };
    }

    return {
      key: "attention",
      title: "NFL data review",
      detail:
        "Refresh the background sync and confirm all Week results are loaded.",
    };
  }, [
    exceptionCount,
    finalCount,
    liveCount,
    playingScores.length,
    preview.can_finalize,
    scheduledCount,
    scoring.currentWeek,
    scoring.result,
    seasonLaunched,
  ]);

  const nextAction = useMemo(() => {
    if (!seasonLaunched) {
      if (!cloud.poolStatus?.schedule_locked) {
        return "Publish and lock the official 32-line schedule.";
      }

      if (cloud.claimedCount < 32) {
        return `Continue onboarding. ${32 - cloud.claimedCount} schedule number${
          32 - cloud.claimedCount === 1 ? "" : "s"
        } remain unclaimed.`;
      }

      if (cloud.poolStatus?.enrollment_open) {
        return "Close number selection and begin commissioner review.";
      }

      if (!backupsReady) {
        return "Assign both Backup Commissioners.";
      }

      return "Review Season Launch Controls and type LAUNCH 2026.";
    }

    if (!syncHealthy) {
      return "Refresh or manually run the secure background NFL sync.";
    }

    if (liveCount > 0) {
      return "No manual action is required. Continue monitoring live games.";
    }

    if (exceptionCount > 0) {
      return "Review postponed or canceled games before finalization.";
    }

    if (
      finalCount === playingScores.length &&
      playingScores.length > 0 &&
      preview.can_finalize
    ) {
      return `Jimbo should review Final Week Controls and type FINALIZE WEEK ${scoring.currentWeek}.`;
    }

    if (!preview.all_players_claimed) {
      return "Resolve missing player claims before finalization.";
    }

    if (scheduledCount > 0) {
      return "Wait for games to begin. Firebase checks every 10 minutes.";
    }

    return "Review any missing scores or provider warnings.";
  }, [
    backupsReady,
    cloud.claimedCount,
    cloud.poolStatus?.enrollment_open,
    cloud.poolStatus?.schedule_locked,
    exceptionCount,
    finalCount,
    liveCount,
    playingScores.length,
    preview.all_players_claimed,
    preview.can_finalize,
    scheduledCount,
    scoring.currentWeek,
    seasonLaunched,
    syncHealthy,
  ]);

  const checklist = [
    {
      label: "2026 season launched",
      value: seasonLaunched ? "Live" : "Preseason",
      passed: seasonLaunched,
      informational: !seasonLaunched,
    },
    {
      label: "Background NFL sync",
      value: syncHealthy
        ? `Healthy · ${syncAgeMinutes} min ago`
        : background?.outcome === "error"
          ? "Needs attention"
          : "Refresh status",
      passed: syncHealthy,
    },
    {
      label: "NFL team coverage",
      value: `${teamCoverage}/32 teams`,
      passed: teamCoverage >= 32,
    },
    {
      label: "Schedule claims",
      value: `${cloud.claimedCount}/32 claimed`,
      passed: cloud.claimedCount === 32,
    },
    {
      label: "Playing teams final",
      value: `${finalCount}/${playingScores.length || 32} final`,
      passed:
        playingScores.length > 0 &&
        finalCount === playingScores.length,
    },
    {
      label: "Player payments current",
      value: `${paymentCurrentCount}/${cloud.claimedCount} current`,
      passed:
        cloud.claimedCount > 0 &&
        paymentCurrentCount === cloud.claimedCount,
      informational: true,
    },
  ];

  async function refreshAll() {
    setBusy("refresh");
    setMessage("");
    setError("");

    try {
      const [
        nextBackground,
      ] = await Promise.all([
        fetchBackgroundNflSyncStatus(),
        cloud.refresh(),
        scoring.refresh(),
        payments.refresh(),
        team.refresh(),
      ]);

      setBackground(nextBackground);
      setMessage("Weekly operations data refreshed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Weekly operations could not be refreshed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setBusy("sync");
    setMessage("");
    setError("");

    try {
      const nextStatus = await runSecureCloudNflSync(
        scoring.currentWeek,
      );
      setBackground(nextStatus);
      await scoring.refreshWeek(scoring.currentWeek);
      setMessage(
        `Week ${scoring.currentWeek} was synced securely in Firebase.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The secure NFL sync failed.",
      );
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void fetchBackgroundNflSyncStatus()
      .then(setBackground)
      .catch(() => setBackground(null));
  }, []);

  return (
    <section className="section-card weekly-operations-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 17</p>
          <h2>Weekly Operations Command Center</h2>
          <p>
            One place to see the current pool phase, NFL progress,
            payment readiness, prize status, and the next required
            commissioner action.
          </p>
        </div>
        <span
          className={`generator-status operations-${phase.key}`}
        >
          {phase.title}
        </span>
      </div>

      <div className="weekly-operations-hero">
        <div>
          <small>Current operations phase</small>
          <strong>{phase.title}</strong>
          <p>{phase.detail}</p>
        </div>
        <div className="weekly-operations-week">
          <span>Week</span>
          <strong>{scoring.currentWeek}</strong>
          <small>
            Last finalized: {lastFinalizedWeek || "None"}
          </small>
        </div>
      </div>

      <div className="weekly-operations-next">
        <span>Next commissioner action</span>
        <strong>{nextAction}</strong>
      </div>

      <div className="weekly-operations-checks">
        {checklist.map((item) => (
          <article
            className={
              item.passed
                ? "passed"
                : item.informational
                  ? "informational"
                  : "attention"
            }
            key={item.label}
          >
            <span aria-hidden="true">
              {item.passed
                ? "✓"
                : item.informational
                  ? "i"
                  : "!"}
            </span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.value}</small>
            </div>
          </article>
        ))}
      </div>

      <div className="weekly-game-progress">
        <div>
          <span>Scheduled</span>
          <strong>{scheduledCount}</strong>
        </div>
        <div>
          <span>Live</span>
          <strong>{liveCount}</strong>
        </div>
        <div>
          <span>Final</span>
          <strong>{finalCount}</strong>
        </div>
        <div>
          <span>Exceptions</span>
          <strong>{exceptionCount}</strong>
        </div>
        <div>
          <span>Byes</span>
          <strong>{byeCount}</strong>
        </div>
        <div>
          <span>Manual overrides</span>
          <strong>{manualOverrideCount}</strong>
        </div>
      </div>

      <div className="weekly-financial-progress">
        <div>
          <span>Current players</span>
          <strong>{paymentCurrentCount}</strong>
        </div>
        <div>
          <span>Behind</span>
          <strong>{paymentBehindCount}</strong>
        </div>
        <div>
          <span>Current pot</span>
          <strong>{dollars(scoring.currentPotCents)}</strong>
        </div>
        <div>
          <span>Pending prizes</span>
          <strong>{pendingWinnerCount}</strong>
        </div>
        <div>
          <span>Held prizes</span>
          <strong>{heldWinnerCount}</strong>
        </div>
        <div>
          <span>Paid prizes</span>
          <strong>{paidWinnerCount}</strong>
        </div>
      </div>

      <div className="weekly-sync-detail">
        <div>
          <span>Last cloud sync</span>
          <strong>
            {formatDate(background?.completed_at ?? null)}
          </strong>
        </div>
        <div>
          <span>Provider</span>
          <strong>
            {background?.provider ??
              scoring.providerSummary?.provider ??
              "ESPN NFL scoreboard"}
          </strong>
        </div>
        <div>
          <span>Sync message</span>
          <strong>
            {background?.message ??
              scoring.providerError ??
              "Waiting for current background status."}
          </strong>
        </div>
      </div>

      <div className="weekly-operations-actions">
        <button
          disabled={Boolean(busy)}
          onClick={() => void refreshAll()}
          type="button"
        >
          {busy === "refresh"
            ? "Refreshing Everything…"
            : "Refresh Weekly Operations"}
        </button>
        <button
          className="generator-primary"
          disabled={Boolean(busy) || Boolean(scoring.result)}
          onClick={() => void syncNow()}
          type="button"
        >
          {busy === "sync"
            ? "Running Secure Sync…"
            : `Sync Week ${scoring.currentWeek} Now`}
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            scrollToPanel(".cloud-scoring-panel")
          }
          type="button"
        >
          View Finalization Controls
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            scrollToPanel(".cloud-payment-ledger")
          }
          type="button"
        >
          View Payment Ledger
        </button>
      </div>

      {!isPrimary && (
        <div className="generator-message">
          Backup commissioners can refresh, sync, and review weekly
          operations. Jimbo remains responsible for finalization,
          reopening, and marking prizes paid.
        </div>
      )}

      {message && (
        <div className="generator-message success">
          {message}
        </div>
      )}

      {error && (
        <div className="generator-message error">
          {error}
        </div>
      )}
    </section>
  );
}
