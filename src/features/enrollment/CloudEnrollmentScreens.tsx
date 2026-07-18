import { useEffect, useState } from "react";
import type { CloudEnrollmentState, CloudProfile, CloudWeeklyRow } from "../../types/cloud";

export function CloudNumberBoard({
  cloud,
  profile,
}: {
  cloud: CloudEnrollmentState;
  profile: CloudProfile;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const confirm = async () => {
    if (selected === null) return;
    setBusy(true);
    setMessage("");
    try {
      await cloud.claimNumber(selected);
      setMessage(`Schedule #${selected} is confirmed. Its teams are now visible on My Line.`);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-stack">
      <section className="screen-intro">
        <p className="eyebrow">Secure cloud selection</p>
        <h2>{cloud.ownClaim ? `Schedule #${cloud.ownClaim.schedule_number}` : "Choose an available number"}</h2>
        <p>Only the number is visible before confirmation. The teams behind every available number remain protected by database security.</p>
      </section>

      <section className="player-name-banner">
        <div><small>Signed in as</small><strong>{profile.display_name}</strong></div>
        <span>{cloud.poolStatus?.enrollment_open ? "Enrollment open" : "Enrollment closed"}</span>
      </section>

      {!cloud.ownClaim && (
        <>
          <section className="selection-summary">
            <div><span className="availability-dot available"/><strong>Available</strong></div>
            <div><span className="availability-dot claimed"/><strong>Player name</strong></div>
            <div><span className="availability-dot mine"/><strong>Selected</strong></div>
          </section>

          <section className="number-grid">
            {cloud.numberBoard.map((slot) => (
              <button
                className={`number-card ${slot.claimed ? "claimed" : selected === slot.schedule_number ? "selected" : "available"}`}
                disabled={slot.claimed || !cloud.poolStatus?.enrollment_open || busy}
                key={slot.schedule_number}
                onClick={() => setSelected(slot.schedule_number)}
                type="button"
              >
                <strong>{slot.schedule_number}</strong>
                <span>{slot.player_name ?? (selected === slot.schedule_number ? "Selected" : "Open")}</span>
              </button>
            ))}
          </section>

          {selected !== null && (
            <section className="claim-confirm-card">
              <div>
                <small>Selected number</small>
                <strong>Schedule #{selected}</strong>
                <p>The team schedule remains hidden. Confirmation is permanent unless a commissioner releases the number.</p>
              </div>
              <div>
                <button disabled={busy} onClick={() => setSelected(null)} type="button">Cancel</button>
                <button className="generator-primary" disabled={busy} onClick={() => void confirm()} type="button">
                  {busy ? "Claiming…" : `Confirm #${selected}`}
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {cloud.ownClaim && (
        <section className="claim-success-card">
          <div className="claim-success-number">#{cloud.ownClaim.schedule_number}</div>
          <div><small>Confirmed player</small><strong>{profile.display_name}</strong><p>This cloud claim is attached to your authenticated account.</p></div>
        </section>
      )}
      {message && <section className="generator-message">{message}</section>}
      {cloud.error && <section className="generator-error">{cloud.error}</section>}
    </div>
  );
}

export function CloudMySchedule({ cloud, profile }: { cloud: CloudEnrollmentState; profile: CloudProfile }) {
  if (!cloud.ownClaim) {
    return <div className="screen-stack"><section className="empty-schedule-card"><div className="claim-success-number">?</div><h2>No number claimed</h2><p>Choose a number first. Teams cannot be previewed before confirmation.</p></section></div>;
  }

  return (
    <div className="screen-stack">
      <section className="line-summary-card">
        <div><p>Player</p><strong>{profile.display_name}</strong></div>
        <div><p>Line</p><strong>#{cloud.ownClaim.schedule_number}</strong></div>
        <div><p>Season</p><strong>17 + 1</strong></div>
      </section>
      <section className="screen-intro compact"><p className="eyebrow">Cloud schedule revealed</p><h2>Your 18 weekly teams</h2><p>Only you and commissioners can read this complete schedule.</p></section>
      <section className="schedule-list">
        {cloud.ownSchedule.map((assignment) => (
          <article className={`schedule-card ${assignment.isBye ? "bye" : ""}`} key={assignment.week}>
            <div className="week-box"><small>WK</small><strong>{assignment.week}</strong></div>
            <div className="team-code-box">{assignment.teamCode}</div>
            <div className="schedule-team-copy"><strong>{assignment.teamName}</strong><span>{assignment.isBye ? "Your pool bye" : "Playing assignment"}</span></div>
            <div className="schedule-result">{assignment.isBye ? <span className="pill bye">BYE</span> : <span>—</span>}</div>
          </article>
        ))}
      </section>
    </div>
  );
}

export function CloudWeeklyBoard({ cloud }: { cloud: CloudEnrollmentState }) {
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState<CloudWeeklyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void cloud.loadWeeklyBoard(week)
      .then((data) => { if (active) setRows(data); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Weekly board failed to load."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cloud, week]);

  return (
    <div className="screen-stack">
      <section className="week-banner"><div><small>Cloud assignment board</small><strong>Week {week}</strong><span>Future teams remain hidden unless they are yours</span></div><div><small>Claimed</small><strong>{cloud.claimedCount}/32</strong></div></section>
      <section className="week-selector">{Array.from({ length: 18 }, (_, index) => index + 1).map((item) => <button className={item === week ? "active" : ""} key={item} onClick={() => setWeek(item)} type="button">{item}</button>)}</section>
      {loading && <section className="info-banner">Loading Week {week}…</section>}
      {error && <section className="generator-error">{error}</section>}
      <section className="assignment-list">
        {rows.map((row) => (
          <article className={`assignment-row ${row.mine ? "mine" : ""}`} key={row.schedule_number}>
            <div className="assignment-number">#{row.schedule_number}</div>
            <div className={`team-code-box small ${row.team_code ? "" : "hidden-team"}`}>{row.team_code ?? "?"}</div>
            <div className="assignment-copy"><strong>{row.player_name ?? "Available"}</strong><span>{row.team_name ?? "Schedule remains hidden"}</span></div>
            <div className="assignment-score">{row.is_bye ? <span className="pill bye">BYE</span> : <span>{row.player_name ? "—" : "OPEN"}</span>}</div>
          </article>
        ))}
      </section>
    </div>
  );
}
