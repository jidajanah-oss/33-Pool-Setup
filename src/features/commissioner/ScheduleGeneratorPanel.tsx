import { useMemo, useState } from "react";
import { NFL_2026_BYE_SOURCE, NFL_2026_BYE_WEEKS } from "../../data/nfl2026";
import {
  generateScheduleSet,
  lockScheduleSet,
  validateScheduleLines,
} from "../../engine/scheduleGenerator";
import type { GeneratedScheduleSet } from "../../types/pool";
import { notifyEnrollmentChanged } from "../../services/enrollmentService";

const STORAGE_KEY = "33-pool-2026-anonymous-schedule-set";

function readStoredSchedule(): GeneratedScheduleSet | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as GeneratedScheduleSet;
    const validation = validateScheduleLines(parsed.lines ?? []);

    return {
      ...parsed,
      validation,
    };
  } catch {
    return null;
  }
}

function saveSchedule(schedule: GeneratedScheduleSet | null) {
  if (!schedule) {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyEnrollmentChanged();
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  notifyEnrollmentChanged();
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not locked";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ScheduleGeneratorPanel() {
  const [schedule, setSchedule] = useState<GeneratedScheduleSet | null>(() =>
    readStoredSchedule(),
  );
  const [selectedLine, setSelectedLine] = useState(1);
  const [message, setMessage] = useState(
    "Generate 32 hidden schedule lines using the official 2026 NFL bye weeks.",
  );
  const [error, setError] = useState("");

  const activeLine = useMemo(
    () => schedule?.lines.find((line) => line.lineNumber === selectedLine) ?? null,
    [schedule, selectedLine],
  );

  const commitSchedule = (nextSchedule: GeneratedScheduleSet) => {
    saveSchedule(nextSchedule);
    setSchedule(nextSchedule);
    setError("");
  };

  const handleGenerate = () => {
    if (schedule?.lockedAt) {
      setError("The official schedule is locked and cannot be regenerated.");
      return;
    }

    if (
      schedule &&
      !window.confirm(
        "Replace the current draft with a completely new random schedule set?",
      )
    ) {
      return;
    }

    try {
      const generated = generateScheduleSet();
      commitSchedule(generated);
      setSelectedLine(1);
      setMessage(
        "A new draft was generated and passed every schedule validation check.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Schedule generation failed.",
      );
    }
  };

  const handleValidate = () => {
    if (!schedule) {
      setError("Generate a schedule before running validation.");
      return;
    }

    const validation = validateScheduleLines(schedule.lines);
    const nextSchedule = { ...schedule, validation };
    commitSchedule(nextSchedule);
    setMessage(
      validation.isValid
        ? "Validation passed. All 32 lines are ready for commissioner review."
        : "Validation found errors. The schedule cannot be locked.",
    );
  };

  const handleLock = () => {
    if (!schedule) {
      setError("Generate and validate a schedule before locking it.");
      return;
    }

    if (schedule.lockedAt) {
      setMessage("The official schedule is already locked.");
      return;
    }

    if (
      !window.confirm(
        "Lock these 32 schedule lines as the official 2026 pool schedule? Regeneration will be disabled.",
      )
    ) {
      return;
    }

    try {
      const locked = lockScheduleSet(schedule);
      commitSchedule(locked);
      setMessage(
        "Official schedules locked. The teams behind unclaimed numbers remain hidden from players.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The schedule could not be locked.",
      );
    }
  };

  const handleClearDraft = () => {
    if (!schedule || schedule.lockedAt) {
      return;
    }

    if (!window.confirm("Delete the current unlocked schedule draft?")) {
      return;
    }

    saveSchedule(null);
    setSchedule(null);
    setSelectedLine(1);
    setError("");
    setMessage("Draft removed. Generate a new schedule set when ready.");
  };

  const handleExport = () => {
    if (!schedule) {
      setError("There is no schedule to export.");
      return;
    }

    const blob = new Blob([JSON.stringify(schedule, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${schedule.id}${schedule.lockedAt ? "-LOCKED" : "-DRAFT"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Schedule backup downloaded as JSON.");
  };

  const status = !schedule
    ? "Not generated"
    : schedule.lockedAt
      ? "Official and locked"
      : "Draft ready";

  return (
    <section className="schedule-generator-panel">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 3</p>
          <h2>Anonymous Schedule Generator</h2>
          <p>
            Creates all 32 numbered lines for all 18 weeks. Player names are not
            needed, and teams stay hidden until a number is claimed.
          </p>
        </div>
        <span className={`generator-status ${schedule?.lockedAt ? "locked" : ""}`}>
          {status}
        </span>
      </div>

      <div className="generator-action-grid">
        <button
          className="generator-primary"
          disabled={Boolean(schedule?.lockedAt)}
          onClick={handleGenerate}
          type="button"
        >
          {schedule ? "Regenerate Draft" : "Generate 32 Lines"}
        </button>
        <button disabled={!schedule} onClick={handleValidate} type="button">
          Validate
        </button>
        <button
          disabled={!schedule || Boolean(schedule.lockedAt)}
          onClick={handleLock}
          type="button"
        >
          Lock Official Schedule
        </button>
        <button disabled={!schedule} onClick={handleExport} type="button">
          Export Backup
        </button>
      </div>

      {error && <div className="generator-message error">{error}</div>}
      {!error && <div className="generator-message">{message}</div>}

      <div className="generator-source-note">
        <strong>2026 bye-week source loaded</strong>
        <span>
          {NFL_2026_BYE_SOURCE.label} · Published {NFL_2026_BYE_SOURCE.published}
        </span>
      </div>

      <div className="bye-week-strip">
        {NFL_2026_BYE_WEEKS.map((group) => (
          <div key={group.week}>
            <strong>W{group.week}</strong>
            <span>{group.teams.map((team) => team.code).join(" · ")}</span>
          </div>
        ))}
      </div>

      {schedule && (
        <>
          <div className="validation-grid">
            <ValidationCard
              label="Lines"
              value={`${schedule.validation.lineCount}/32`}
              good={schedule.validation.lineCount === 32}
            />
            <ValidationCard
              label="Weeks"
              value={`${schedule.validation.weekCount}/18`}
              good={schedule.validation.weekCount === 18}
            />
            <ValidationCard
              label="Assignments"
              value={`${schedule.validation.assignmentCount}/576`}
              good={schedule.validation.assignmentCount === 576}
            />
            <ValidationCard
              label="Player Byes"
              value={`${schedule.validation.byeAssignmentCount}/32`}
              good={schedule.validation.byeAssignmentCount === 32}
            />
          </div>

          <div className="schedule-identity-card">
            <div>
              <small>Randomization ID</small>
              <strong>{schedule.id}</strong>
            </div>
            <div>
              <small>Generated</small>
              <strong>{formatTimestamp(schedule.generatedAt)}</strong>
            </div>
            <div>
              <small>Locked</small>
              <strong>{formatTimestamp(schedule.lockedAt)}</strong>
            </div>
          </div>

          {!schedule.validation.isValid && (
            <div className="validation-errors">
              {schedule.validation.errors.map((validationError) => (
                <span key={validationError}>{validationError}</span>
              ))}
            </div>
          )}

          <div className="line-preview-heading">
            <div>
              <h3>Commissioner Line Preview</h3>
              <p>Players cannot see an unclaimed line’s teams.</p>
            </div>
            <select
              aria-label="Choose schedule line to preview"
              onChange={(event) => setSelectedLine(Number(event.target.value))}
              value={selectedLine}
            >
              {schedule.lines.map((line) => (
                <option key={line.lineNumber} value={line.lineNumber}>
                  Schedule #{line.lineNumber}
                </option>
              ))}
            </select>
          </div>

          {activeLine && (
            <div className="generated-line-grid">
              {activeLine.assignments.map((assignment) => (
                <article
                  className={assignment.isBye ? "generated-week bye" : "generated-week"}
                  key={assignment.week}
                >
                  <div>
                    <small>Week</small>
                    <strong>{assignment.week}</strong>
                  </div>
                  <span>{assignment.teamCode}</span>
                  <div>
                    <strong>{assignment.teamName}</strong>
                    <small>{assignment.isBye ? "PLAYER BYE" : "Playing team"}</small>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="generator-footer-actions">
            <button
              disabled={Boolean(schedule.lockedAt)}
              onClick={handleClearDraft}
              type="button"
            >
              Delete Unlocked Draft
            </button>
            <button disabled type="button">
              Open Number Selection — Future Package
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ValidationCard({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <article className={good ? "validation-card good" : "validation-card bad"}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{good ? "Passed" : "Review"}</span>
    </article>
  );
}
