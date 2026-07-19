import { useState } from "react";
import {
  generateScheduleSet,
  lockScheduleSet,
} from "../../engine/scheduleGenerator";
import {
  notifyEnrollmentChanged,
  SCHEDULE_STORAGE_KEY,
} from "../../services/enrollmentService";
import {
  resetCloud2026Pull,
  type CloudPullResetResult,
} from "../../services/cloudPoolService";
import type {
  CloudPoolStatus,
  CloudRole,
} from "../../types/cloud";

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function CloudPullResetPanel({
  currentRole,
  poolStatus,
  claimedCount,
  onResetComplete,
}: {
  currentRole: CloudRole;
  poolStatus: CloudPoolStatus | null;
  claimedCount: number;
  onResetComplete: () => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] =
    useState<CloudPullResetResult | null>(null);

  if (currentRole !== "primary_commissioner") {
    return null;
  }

  const canReset =
    poolStatus?.season === 2026 &&
    poolStatus.current_week === 1 &&
    poolStatus.schedule_locked &&
    !poolStatus.season_launched &&
    !poolStatus.week_one_locked;

  const resetPull = async () => {
    setError("");
    setResult(null);

    if (confirmation.trim() !== "RESET 2026") {
      setError('Type "RESET 2026" exactly before resetting the pull.');
      return;
    }

    if (
      !window.confirm(
        `Archive the current 2026 pull, release ${claimedCount} claimed schedule number${
          claimedCount === 1 ? "" : "s"
        }, and replace all 32 hidden schedules? Player accounts, invitations, commissioner roles, and payments will be preserved.`,
      )
    ) {
      return;
    }

    setBusy(true);

    try {
      const replacement = lockScheduleSet(generateScheduleSet());
      const completed = await resetCloud2026Pull(
        replacement,
        confirmation,
      );

      window.localStorage.setItem(
        SCHEDULE_STORAGE_KEY,
        JSON.stringify(replacement),
      );
      notifyEnrollmentChanged();

      await onResetComplete();
      setConfirmation("");
      setResult(completed);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The 2026 pull could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-card pull-reset-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Primary Commissioner only</p>
          <h2>Reset the 2026 Pull</h2>
          <p>
            Archives the current pull, releases every claimed number,
            creates a brand-new locked 32-line schedule, and returns the
            pool to Week 1.
          </p>
        </div>
        <span
          className={`generator-status ${
            canReset ? "reset-ready" : ""
          }`}
        >
          {canReset ? "Preseason reset available" : "Reset locked"}
        </span>
      </div>

      <div className="pull-reset-preserved">
        <strong>Preserved</strong>
        <span>
          Player accounts, invitations, Primary and Backup Commissioner
          roles, payment balances, and payment history
        </span>
      </div>

      <div className="pull-reset-cleared">
        <strong>Replaced or cleared</strong>
        <span>
          Current schedule assignments, claimed numbers, Week 1 draft
          scores, public weekly assignments, and the active schedule ID
        </span>
      </div>

      <div className="generator-note">
        The previous pull is stored under a protected Firebase archive.
        Number selection will be <strong>closed</strong> after the reset.
        Open it from Cloud Season Controls when the new pull is ready.
      </div>

      <label className="pull-reset-confirmation">
        Type RESET 2026
        <input
          autoCapitalize="characters"
          disabled={busy || !canReset}
          onChange={(event) =>
            setConfirmation(event.target.value.toUpperCase())
          }
          placeholder="RESET 2026"
          value={confirmation}
        />
      </label>

      <button
        className="pull-reset-button"
        disabled={
          busy ||
          !canReset ||
          confirmation.trim() !== "RESET 2026"
        }
        onClick={() => void resetPull()}
        type="button"
      >
        {busy ? "Archiving and Creating New Pull…" : "Archive and Reset 2026 Pull"}
      </button>

      {!canReset && (
        <div className="generator-message error">
          Reset is available only for the active 2026 season on Week 1,
          before any week has been finalized.
        </div>
      )}

      {error && <div className="generator-message error">{error}</div>}

      {result && (
        <div className="pull-reset-success">
          <strong>New 2026 pull created</strong>
          <span>New schedule: {result.new_schedule_id}</span>
          <span>
            Released claims: {result.previous_claim_count}
          </span>
          <span>
            Archived: {formatTimestamp(result.reset_at)}
          </span>
          <small>Archive ID: {result.archive_id}</small>
        </div>
      )}
    </section>
  );
}
