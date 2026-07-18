import { useMemo, useState } from "react";
import type { ViewMode } from "../../types/pool";
import type { LocalEnrollmentController } from "./useLocalEnrollment";

export function EnrollmentNumberBoard({ enrollment }: { enrollment: LocalEnrollmentController }) {
  const [name, setName] = useState(enrollment.profile?.name ?? "");
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const claimedByNumber = useMemo(
    () => new Map(enrollment.claims.map((claim) => [claim.scheduleNumber, claim])),
    [enrollment.claims],
  );
  const ready = Boolean(enrollment.schedule?.lockedAt && enrollment.schedule.validation.isValid);

  const saveName = () => {
    try { enrollment.saveName(name); setError(""); setMessage("Name saved. Choose any available number."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Name could not be saved."); }
  };

  const confirm = () => {
    if (selected === null) return;
    try {
      enrollment.claimNumber(selected);
      setMessage(`Schedule #${selected} is confirmed. The teams are now revealed on My Line.`);
      setError("");
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Number could not be claimed.");
    }
  };

  return <div className="screen-stack">
    <section className="screen-intro">
      <p className="eyebrow">Blind number selection</p>
      <h2>{enrollment.ownClaim ? `Schedule #${enrollment.ownClaim.scheduleNumber}` : "Choose an available number"}</h2>
      <p>No NFL team or bye information appears until the number is confirmed.</p>
    </section>

    {!enrollment.profile && <section className="section-card enrollment-name-card">
      <h2>Enter the player's name</h2>
      <p>This local profile is only for workflow testing before Supabase sign-in.</p>
      <label>Player name<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="Enter player name" /></label>
      <button className="generator-primary" onClick={saveName} type="button">Continue</button>
    </section>}

    {enrollment.profile && !enrollment.ownClaim && <>
      <section className="player-name-banner"><div><small>Choosing for</small><strong>{enrollment.profile.name}</strong></div><span>{ready ? "Ready" : "Waiting for locked lines"}</span></section>
      <section className="selection-summary"><div><span className="availability-dot available"/><strong>Available</strong></div><div><span className="availability-dot claimed"/><strong>Player name</strong></div><div><span className="availability-dot mine"/><strong>Selected</strong></div></section>
      <section className="number-grid">
        {Array.from({ length: 32 }, (_, index) => index + 1).map((number) => {
          const claim = claimedByNumber.get(number);
          return <button key={number} type="button" disabled={Boolean(claim) || !ready} onClick={() => setSelected(number)} className={`number-card ${claim ? "claimed" : selected === number ? "selected" : "available"}`}>
            <strong>{number}</strong><span>{claim?.playerName ?? (selected === number ? "Selected" : "Open")}</span>
          </button>;
        })}
      </section>
      {selected !== null && <section className="claim-confirm-card"><div><small>Selected number</small><strong>Schedule #{selected}</strong><p>The teams remain hidden until you confirm this permanent choice.</p></div><div><button onClick={() => setSelected(null)} type="button">Cancel</button><button className="generator-primary" onClick={confirm} type="button">Confirm #{selected}</button></div></section>}
    </>}

    {enrollment.ownClaim && <section className="claim-success-card"><div className="claim-success-number">#{enrollment.ownClaim.scheduleNumber}</div><div><small>Confirmed player</small><strong>{enrollment.ownClaim.playerName}</strong><p>The selected line is permanently attached to this local test profile.</p></div></section>}
    {!ready && <section className="info-banner">The commissioner must generate, validate, and lock the 32 anonymous schedules before number selection opens.</section>}
    {message && <section className="generator-message">{message}</section>}
    {error && <section className="generator-error">{error}</section>}
  </div>;
}

export function EnrollmentMySchedule({ enrollment }: { enrollment: LocalEnrollmentController }) {
  const line = enrollment.ownClaim && enrollment.schedule
    ? enrollment.schedule.lines.find((item) => item.lineNumber === enrollment.ownClaim?.scheduleNumber) ?? null
    : null;

  if (!enrollment.ownClaim || !line) return <div className="screen-stack"><section className="empty-schedule-card"><div className="claim-success-number">?</div><h2>No number claimed</h2><p>Choose a number first. Teams cannot be previewed before confirmation.</p></section></div>;

  return <div className="screen-stack">
    <section className="line-summary-card"><div><p>Player</p><strong>{enrollment.ownClaim.playerName}</strong></div><div><p>Line</p><strong>#{line.lineNumber}</strong></div><div><p>Season</p><strong>17 + 1</strong></div></section>
    <section className="screen-intro compact"><p className="eyebrow">Schedule revealed</p><h2>Your 18 weekly teams</h2><p>One assignment is the actual NFL bye for that team.</p></section>
    <section className="schedule-list">{line.assignments.map((assignment) => <article className={`schedule-card ${assignment.isBye ? "bye" : ""}`} key={assignment.week}><div className="week-box"><small>WK</small><strong>{assignment.week}</strong></div><div className="team-code-box">{assignment.teamCode}</div><div className="schedule-team-copy"><strong>{assignment.teamName}</strong><span>{assignment.isBye ? "Your pool bye" : "Playing assignment"}</span></div><div className="schedule-result">{assignment.isBye ? <span className="pill bye">BYE</span> : <span>—</span>}</div></article>)}</section>
  </div>;
}

export function EnrollmentWeeklyBoard({ enrollment, viewMode }: { enrollment: LocalEnrollmentController; viewMode: ViewMode }) {
  const [week, setWeek] = useState(1);
  const claims = useMemo(() => new Map(enrollment.claims.map((claim) => [claim.scheduleNumber, claim])), [enrollment.claims]);
  if (!enrollment.schedule?.lockedAt) return <div className="screen-stack"><section className="empty-schedule-card"><div className="claim-success-number">32</div><h2>Board not ready</h2><p>The commissioner must lock the official schedules first.</p></section></div>;

  return <div className="screen-stack">
    <section className="week-banner"><div><small>Assignment board</small><strong>Week {week}</strong><span>Names replace temporary player labels</span></div><div><small>Claimed</small><strong>{enrollment.claims.length}/32</strong></div></section>
    <section className="week-selector">{Array.from({ length: 18 }, (_, i) => i + 1).map((item) => <button className={item === week ? "active" : ""} onClick={() => setWeek(item)} key={item} type="button">{item}</button>)}</section>
    <section className="assignment-list">{enrollment.schedule.lines.map((line) => {
      const claim = claims.get(line.lineNumber);
      const assignment = line.assignments.find((item) => item.week === week);
      const visible = viewMode === "commissioner" || Boolean(claim);
      const mine = enrollment.ownClaim?.scheduleNumber === line.lineNumber;
      return <article className={`assignment-row ${mine ? "mine" : ""}`} key={line.lineNumber}><div className="assignment-number">#{line.lineNumber}</div><div className={`team-code-box small ${visible ? "" : "hidden-team"}`}>{visible ? assignment?.teamCode : "?"}</div><div className="assignment-copy"><strong>{claim?.playerName ?? "Available"}</strong><span>{visible ? assignment?.teamName : "Schedule remains hidden"}</span></div><div className="assignment-score">{visible && assignment?.isBye ? <span className="pill bye">BYE</span> : <span>{claim ? "—" : "OPEN"}</span>}</div></article>;
    })}</section>
  </div>;
}
