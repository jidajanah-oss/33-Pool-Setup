import type {
  CloudScoringState,
  CloudWeeklyResult,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function dollars(cents: number): string {
  return currency.format(cents / 100);
}

function resultLabel(result: CloudWeeklyResult): string {
  if (result.resolution_type === "exact_33") {
    return result.winner_count === 1
      ? "Exact 33 winner"
      : `${result.winner_count} exact-33 winners`;
  }

  if (result.resolution_type === "closest_33") {
    return result.winner_count === 1
      ? "Week 18 closest-to-33 winner"
      : `${result.winner_count} closest-to-33 winners`;
  }

  return "No 33 — pot carried forward";
}

export function CloudPotScreen({
  scoring,
}: {
  scoring: CloudScoringState;
}) {
  const orderedHistory = [...scoring.history].sort(
    (a, b) => b.week - a.week,
  );

  return (
    <div className="screen-stack">
      <section className="pot-hero">
        <p>Current accumulated pot</p>
        <strong>{dollars(scoring.currentPotCents)}</strong>
        <span>
          Week {scoring.currentWeek} · $96 added every week
        </span>
      </section>

      <section className="mobile-stat-grid">
        <article className="stat-card">
          <small>Weekly addition</small>
          <strong>$96</strong>
          <span>32 players × $3</span>
        </article>
        <article className="stat-card">
          <small>Season total</small>
          <strong>$1,728</strong>
          <span>18 paid weeks</span>
        </article>
        <article className="stat-card">
          <small>Final-score target</small>
          <strong>33</strong>
          <span>Win, loss, or tie</span>
        </article>
        <article className="stat-card">
          <small>Final week rule</small>
          <strong>Closest</strong>
          <span>Split when tied</span>
        </article>
      </section>

      <section className="section-card">
        <div className="payment-history-heading">
          <div>
            <h2>Weekly Pot History</h2>
            <p>Finalized Firebase scoring and payout records</p>
          </div>
          <button
            disabled={scoring.loading}
            onClick={() => void scoring.refresh()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {orderedHistory.length === 0 ? (
          <div className="empty-copy">
            No NFL week has been finalized yet.
          </div>
        ) : (
          <div className="cloud-pot-history">
            {orderedHistory.map((result) => (
              <article key={result.week}>
                <div className="cloud-pot-week">
                  <small>WK</small>
                  <strong>{result.week}</strong>
                </div>
                <div>
                  <strong>{resultLabel(result)}</strong>
                  <span>
                    {dollars(result.carryover_in_cents)} carry-in + $96
                  </span>
                </div>
                <div>
                  <strong>{dollars(result.total_pot_cents)}</strong>
                  <span>
                    {result.carryover_out_cents > 0
                      ? `${dollars(result.carryover_out_cents)} carried`
                      : `${dollars(result.total_payout_cents)} awarded`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        {scoring.error && (
          <div className="generator-message error">
            {scoring.error}
          </div>
        )}
      </section>

      {scoring.winners.length > 0 && (
        <section className="section-card">
          <div className="section-heading">
            <h2>Week {scoring.selectedWeek} Winners</h2>
            <p>Prize status and exact final score</p>
          </div>
          <div className="cloud-winner-list">
            {scoring.winners.map((winner) => (
              <article key={winner.id}>
                <div className="team-code-box">
                  {winner.team_code}
                </div>
                <div>
                  <strong>{winner.player_name}</strong>
                  <span>
                    Schedule #{winner.schedule_number} ·{" "}
                    {winner.final_score} points
                  </span>
                </div>
                <div>
                  <strong>{dollars(winner.payout_cents)}</strong>
                  <span>{winner.payout_status.replace("_", " ")}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
