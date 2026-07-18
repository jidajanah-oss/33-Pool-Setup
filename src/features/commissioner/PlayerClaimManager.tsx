import type { LocalEnrollmentController } from "../enrollment/useLocalEnrollment";

export function PlayerClaimManager({ enrollment }: { enrollment: LocalEnrollmentController }) {
  const claimed = new Map(enrollment.claims.map((claim) => [claim.scheduleNumber, claim]));
  const release = (number: number) => {
    if (window.confirm(`Release Schedule #${number}?`)) enrollment.releaseNumber(number);
  };
  const clear = () => {
    if (window.confirm("Clear all local test claims?")) enrollment.clearClaims();
  };
  return <section className="section-card claim-manager"><div className="generator-heading"><div><p className="eyebrow">Package 4</p><h2>Player Number Claims</h2><p>Claimed numbers show player names. Teams remain protected until confirmation.</p></div><span className="generator-status">{enrollment.claims.length} of 32</span></div><div className="commissioner-claim-grid">{Array.from({ length: 32 }, (_, i) => i + 1).map((number) => { const claim = claimed.get(number); return <article className={`commissioner-claim ${claim ? "claimed" : ""}`} key={number}><div><small>Schedule #{number}</small><strong>{claim?.playerName ?? "Available"}</strong></div>{claim && <button onClick={() => release(number)} type="button">Release</button>}</article>; })}</div>{enrollment.claims.length > 0 && <button className="claim-danger-button" onClick={clear} type="button">Clear All Local Test Claims</button>}<p className="generator-note">Cloud authentication and atomic simultaneous claims come in the Supabase package.</p></section>;
}
