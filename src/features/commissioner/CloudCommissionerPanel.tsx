import { useState } from "react";
import { readScheduleSet } from "../../services/enrollmentService";
import type { CloudAuthController } from "../auth/useCloudAuth";
import type { CloudEnrollmentState } from "../../types/cloud";

export function CloudCommissionerPanel({
  auth,
  cloud,
}: {
  auth: CloudAuthController;
  cloud: CloudEnrollmentState;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isCommissioner =
    auth.profile?.role === "primary_commissioner" ||
    auth.profile?.role === "co_commissioner";
  const seasonLaunched =
    cloud.poolStatus?.season_launched === true;

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
      setMessage(success);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Firebase commissioner action failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    const schedule = readScheduleSet();

    if (!schedule?.lockedAt || !schedule.validation.isValid) {
      setError(
        "Generate, validate, and lock the local 32-line schedule before publishing it to Firebase.",
      );
      return;
    }

    if (
      !window.confirm(
        "Publish this locked schedule to the new 33 Pool Firebase project and open number selection?",
      )
    ) {
      return;
    }

    await run(
      () => cloud.publishSchedule(schedule),
      "Official schedules published to Firebase. Number selection is open.",
    );
  };

  if (!isCommissioner) {
    return (
      <section className="section-card cloud-commissioner-card">
        <div className="generator-heading">
          <div>
            <p className="eyebrow">Firebase access</p>
            <h2>Commissioner Approval Required</h2>
            <p>
              For security, commissioner access is assigned once in the Firebase
              console. Ordinary player accounts cannot promote themselves.
            </p>
          </div>
          <span className="generator-status">Player account</span>
        </div>

        <div className="generator-note">
          Sign in once, then add an <strong>admins</strong> document whose
          document ID matches this account&apos;s Firebase UID.
        </div>
      </section>
    );
  }

  return (
    <section className="section-card cloud-commissioner-card">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Firebase cloud</p>
          <h2>Cloud Season Controls</h2>
          <p>
            Publish the locally generated anonymous schedule, open or close
            enrollment, and release mistaken claims.
          </p>
        </div>
        <span
          className={`generator-status ${
            cloud.poolStatus?.schedule_locked ? "locked" : ""
          }`}
        >
          {seasonLaunched
            ? "2026 season live"
            : cloud.poolStatus?.schedule_locked
              ? "Firebase schedule locked"
              : "Not published"}
        </span>
      </div>

      <div className="cloud-control-grid">
        <button
          className="generator-primary"
          disabled={busy || Boolean(cloud.poolStatus?.schedule_locked)}
          onClick={() => void publish()}
          type="button"
        >
          Publish Locked Schedule
        </button>

        <button
          disabled={
            busy ||
            seasonLaunched ||
            !cloud.poolStatus?.schedule_locked
          }
          onClick={() =>
            void run(
              () =>
                cloud.setEnrollmentOpen(
                  !cloud.poolStatus?.enrollment_open,
                ),
              cloud.poolStatus?.enrollment_open
                ? "Number selection closed."
                : "Number selection opened.",
            )
          }
          type="button"
        >
          {cloud.poolStatus?.enrollment_open
            ? "Close Number Selection"
            : "Open Number Selection"}
        </button>

        <button
          disabled={busy}
          onClick={() =>
            void run(
              () => cloud.refresh(),
              "Firebase status refreshed.",
            )
          }
          type="button"
        >
          Refresh Firebase Status
        </button>
      </div>

      <div className="cloud-status-grid">
        <div>
          <small>Role</small>
          <strong>{auth.profile?.role.replaceAll("_", " ")}</strong>
        </div>
        <div>
          <small>Schedule</small>
          <strong>
            {cloud.poolStatus?.schedule_locked ? "Published" : "Waiting"}
          </strong>
        </div>
        <div>
          <small>Enrollment</small>
          <strong>
            {cloud.poolStatus?.enrollment_open ? "Open" : "Closed"}
          </strong>
        </div>
        <div>
          <small>Claims</small>
          <strong>{cloud.claimedCount}/32</strong>
        </div>
      </div>

      {cloud.numberBoard.some((slot) => slot.claimed) && (
        <div className="cloud-claim-list">
          {cloud.numberBoard
            .filter((slot) => slot.claimed)
            .map((slot) => (
              <article key={slot.schedule_number}>
                <div>
                  <small>Schedule #{slot.schedule_number}</small>
                  <strong>{slot.player_name}</strong>
                </div>
                <button
                  disabled={busy || seasonLaunched}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Release Schedule #${slot.schedule_number} from ${slot.player_name}?`,
                      )
                    ) {
                      void run(
                        () => cloud.releaseNumber(slot.schedule_number),
                        `Schedule #${slot.schedule_number} released.`,
                      );
                    }
                  }}
                  type="button"
                >
                  Release
                </button>
              </article>
            ))}
        </div>
      )}

      {seasonLaunched && (
        <div className="generator-message success">
          The 2026 season is live. Number selection and claim releases
          are permanently frozen for the active pull.
        </div>
      )}
      {message && <div className="generator-message">{message}</div>}
      {(error || cloud.error) && (
        <div className="generator-message error">{error || cloud.error}</div>
      )}
    </section>
  );
}
