import { useMemo, useState } from "react";
import {
  launchCloud2026Season,
  type CloudSeasonLaunchResult,
} from "../../services/cloudPoolService";
import type {
  CloudCommissionerTeamState,
  CloudEnrollmentState,
  CloudRole,
  CloudScoringState,
} from "../../types/cloud";

interface LaunchCheck {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not launched";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

export function CloudSeasonLaunchPanel({
  currentRole,
  cloud,
  scoring,
  team,
}: {
  currentRole: CloudRole;
  cloud: CloudEnrollmentState;
  scoring: CloudScoringState;
  team: CloudCommissionerTeamState;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<
    "open" | "close" | "launch" | ""
  >("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] =
    useState<CloudSeasonLaunchResult | null>(null);
  const isPrimary = currentRole === "primary_commissioner";
  const launched = cloud.poolStatus?.season_launched === true;
  const launchCommand = "LAUNCH 2026";
  const commandMatches =
    confirmation.trim().toUpperCase() === launchCommand;

  const checklist = useMemo<LaunchCheck[]>(() => {
    const backupsAssigned = Boolean(
      team.backups.backup1 && team.backups.backup2,
    );
    const providerTeamCount =
      scoring.providerSummary?.team_count ?? 0;

    return [
      {
        id: "primary",
        label: "Primary Commissioner",
        detail: isPrimary
          ? "Jimbo is authorized to launch the season."
          : "Only Jimbo can launch the season.",
        passed: isPrimary,
      },
      {
        id: "week",
        label: "Preseason Week 1 State",
        detail:
          cloud.poolStatus?.current_week === 1
            ? "The pool is staged at Week 1."
            : `The pool is currently on Week ${cloud.poolStatus?.current_week ?? "—"}.`,
        passed: cloud.poolStatus?.current_week === 1,
      },
      {
        id: "schedule",
        label: "Official Schedule Locked",
        detail: cloud.poolStatus?.schedule_locked
          ? "The active 32-line schedule is locked."
          : "Publish and lock the schedule first.",
        passed: Boolean(cloud.poolStatus?.schedule_locked),
      },
      {
        id: "claims",
        label: "All 32 Numbers Claimed",
        detail: `${cloud.claimedCount}/32 schedule numbers are claimed.`,
        passed: cloud.claimedCount === 32,
      },
      {
        id: "selection",
        label: "Number Selection Closed",
        detail: cloud.poolStatus?.enrollment_open
          ? "Close number selection before launch."
          : "No additional claims can be made during launch.",
        passed: !cloud.poolStatus?.enrollment_open,
      },
      {
        id: "backups",
        label: "Commissioner Team Complete",
        detail: backupsAssigned
          ? "Both Backup Commissioners are assigned."
          : "Assign Backup Commissioner 1 and 2.",
        passed: backupsAssigned,
      },
      {
        id: "nfl",
        label: "Week 1 NFL Data Loaded",
        detail:
          providerTeamCount >= 32
            ? `${providerTeamCount} NFL teams are available.`
            : `${providerTeamCount}/32 NFL teams loaded in the current provider preview.`,
        passed:
          providerTeamCount >= 32 &&
          !scoring.providerError,
      },
      {
        id: "result",
        label: "No Week 1 Result Exists",
        detail: scoring.result
          ? "Week 1 already has an official result."
          : "Week 1 has not been finalized.",
        passed: !scoring.result,
      },
    ];
  }, [
    cloud.claimedCount,
    cloud.poolStatus,
    isPrimary,
    scoring.providerError,
    scoring.providerSummary,
    scoring.result,
    team.backups.backup1,
    team.backups.backup2,
  ]);

  const blockers = checklist.filter((check) => !check.passed);
  const canLaunch =
    !launched &&
    blockers.length === 0 &&
    commandMatches &&
    !busy;

  async function run(
    action: () => Promise<void>,
    success: string,
    mode: "open" | "close" | "launch",
  ) {
    setBusy(mode);
    setMessage("");
    setError("");

    try {
      await action();
      setMessage(success);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The season launch action failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function launch() {
    if (!commandMatches) {
      setError(`Type ${launchCommand} exactly before launching.`);
      return;
    }

    await run(
      async () => {
        const nextResult =
          await launchCloud2026Season(confirmation);
        setResult(nextResult);
        setConfirmation("");
        await Promise.all([
          cloud.refresh(),
          scoring.refresh(),
          team.refresh(),
        ]);
      },
      "The 2026 season is officially launched and Week 1 claims are frozen.",
      "launch",
    );
  }

  return (
    <section className="section-card season-launch-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 16</p>
          <h2>Season Launch Controls</h2>
          <p>
            Manage the final number-selection window and permanently
            lock the official pool for Week 1.
          </p>
        </div>
        <span
          className={`generator-status ${
            launched ? "locked" : ""
          }`}
        >
          {launched
            ? "2026 Season Live"
            : blockers.length === 0
              ? "Ready to Launch"
              : `${blockers.length} launch blocker${
                  blockers.length === 1 ? "" : "s"
                }`}
        </span>
      </div>

      <div className="season-launch-phase-grid">
        <article
          className={
            cloud.poolStatus?.enrollment_open
              ? "active"
              : "complete"
          }
        >
          <span>1</span>
          <div>
            <strong>Player Enrollment</strong>
            <small>
              Invite players and allow each account to claim one
              hidden schedule number.
            </small>
          </div>
        </article>
        <article
          className={
            !cloud.poolStatus?.enrollment_open &&
            !launched
              ? "active"
              : launched
                ? "complete"
                : ""
          }
        >
          <span>2</span>
          <div>
            <strong>Commissioner Review</strong>
            <small>
              Close selection and verify all 32 claims, backups,
              schedule lines, and Week 1 NFL data.
            </small>
          </div>
        </article>
        <article className={launched ? "active complete" : ""}>
          <span>3</span>
          <div>
            <strong>Week 1 Live</strong>
            <small>
              Claims and the preseason pull are permanently frozen.
            </small>
          </div>
        </article>
      </div>

      {!launched && (
        <div className="season-enrollment-actions">
          <button
            disabled={
              Boolean(busy) ||
              !cloud.poolStatus?.schedule_locked ||
              cloud.poolStatus?.enrollment_open
            }
            onClick={() =>
              void run(
                () => cloud.setEnrollmentOpen(true),
                "Number selection is open.",
                "open",
              )
            }
            type="button"
          >
            {busy === "open"
              ? "Opening…"
              : "Open Number Selection"}
          </button>
          <button
            className="secondary-button"
            disabled={
              Boolean(busy) ||
              !cloud.poolStatus?.enrollment_open
            }
            onClick={() =>
              void run(
                () => cloud.setEnrollmentOpen(false),
                "Number selection is closed for commissioner review.",
                "close",
              )
            }
            type="button"
          >
            {busy === "close"
              ? "Closing…"
              : "Close Number Selection"}
          </button>
        </div>
      )}

      <div className="season-launch-check-grid">
        {checklist.map((check) => (
          <article
            className={check.passed ? "passed" : "waiting"}
            key={check.id}
          >
            <span aria-hidden="true">
              {check.passed ? "✓" : "!"}
            </span>
            <div>
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </div>
          </article>
        ))}
      </div>

      {!launched && (
        <div className="season-launch-confirmation">
          <label>
            <span>
              Type <strong>{launchCommand}</strong> to permanently
              launch Week 1.
            </span>
            <input
              autoComplete="off"
              disabled={!isPrimary || Boolean(busy)}
              onChange={(event) =>
                setConfirmation(event.target.value)
              }
              placeholder={launchCommand}
              type="text"
              value={confirmation}
            />
          </label>
          <button
            className="generator-primary"
            disabled={!canLaunch}
            onClick={() => void launch()}
            type="button"
          >
            {busy === "launch"
              ? "Launching 2026 Season…"
              : "Launch 2026 Season"}
          </button>
        </div>
      )}

      {launched && (
        <div className="season-launch-live-summary">
          <div>
            <span>Launch status</span>
            <strong>Official and live</strong>
          </div>
          <div>
            <span>Launched</span>
            <strong>
              {formatDate(
                cloud.poolStatus?.season_launched_at ?? null,
              )}
            </strong>
          </div>
          <div>
            <span>Launched by</span>
            <strong>
              {cloud.poolStatus?.season_launched_by_name ??
                "Primary Commissioner"}
            </strong>
          </div>
          <div>
            <span>Claims</span>
            <strong>{cloud.claimedCount}/32 frozen</strong>
          </div>
        </div>
      )}

      {result && (
        <div className="season-launch-record">
          <span>Season launch record</span>
          <code>{result.launch_id}</code>
        </div>
      )}

      <p className="season-launch-warning">
        Launching is permanent for the active 2026 pull. After launch,
        number selection cannot reopen, claimed numbers cannot be
        released, and Reset 2026 Pull is disabled.
      </p>

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
