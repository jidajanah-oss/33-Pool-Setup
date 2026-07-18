import type {
  CloudPaymentState,
  CloudProfile,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function dollars(cents: number): string {
  return currency.format(cents / 100);
}

function formatDate(value: string): string {
  if (!value) {
    return "Date not recorded";
  }

  const parsed = new Date(`${value}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
}

export function CloudPaymentsScreen({
  payments,
  profile,
  currentWeek,
}: {
  payments: CloudPaymentState;
  profile: CloudProfile;
  currentWeek: number;
}) {
  const account = payments.myAccount;

  if (payments.loading && !account) {
    return (
      <div className="screen-stack">
        <section className="info-banner">
          Loading your Firebase payment account…
        </section>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="screen-stack">
        <section className="empty-schedule-card">
          <div className="claim-success-number">$</div>
          <h2>Payment account unavailable</h2>
          <p>{payments.error || "Refresh the Firebase payment ledger."}</p>
          <button onClick={() => void payments.refresh()} type="button">
            Refresh Payments
          </button>
        </section>
      </div>
    );
  }

  const progress =
    account.season_amount_due_cents > 0
      ? Math.min(
          100,
          (account.amount_paid_cents /
            account.season_amount_due_cents) *
            100,
        )
      : 0;
  const prizePending = Math.max(
    0,
    account.winnings_earned_cents -
      account.winnings_paid_cents,
  );

  return (
    <div className="screen-stack">
      <section
        className={`payment-status-card ${
          account.payment_status === "current" ? "current" : "late"
        }`}
      >
        <small>Payment eligibility through Week {currentWeek}</small>
        <strong>
          {account.payment_status === "current"
            ? "Current"
            : `${dollars(account.amount_behind_cents)} Behind`}
        </strong>
        <span>
          {account.payment_status === "current"
            ? "Eligible to receive a prize through the current week"
            : "Prize payment remains pending until the account is current"}
        </span>
      </section>

      <section className="section-card">
        <div className="section-heading">
          <h2>{profile.display_name}</h2>
          <p>
            {account.schedule_number
              ? `Schedule #${account.schedule_number}`
              : "No schedule number claimed"}
          </p>
        </div>

        <div className="money-pair">
          <div>
            <small>Paid</small>
            <strong>{dollars(account.amount_paid_cents)}</strong>
          </div>
          <div>
            <small>Season total</small>
            <strong>
              {dollars(account.season_amount_due_cents)}
            </strong>
          </div>
        </div>

        <div className="large-progress">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="detail-list">
          <div>
            <span>Due through Week {currentWeek}</span>
            <strong>
              {dollars(
                account.amount_due_through_current_week_cents,
              )}
            </strong>
          </div>
          <div>
            <span>Remaining season balance</span>
            <strong>
              {dollars(account.remaining_season_balance_cents)}
            </strong>
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-heading">
          <h2>Prize Account</h2>
          <p>Calculated winnings and recorded prize payments</p>
        </div>
        <div className="money-pair">
          <div>
            <small>Earned</small>
            <strong>
              {dollars(account.winnings_earned_cents)}
            </strong>
          </div>
          <div>
            <small>Still pending</small>
            <strong>{dollars(prizePending)}</strong>
          </div>
        </div>
        <div className="empty-copy">
          Exact-33 winnings will be connected in the scoring and payout
          package.
        </div>
      </section>

      <section className="section-card">
        <div className="payment-history-heading">
          <div>
            <h2>Payment History</h2>
            <p>Commissioner-entered Firebase transactions</p>
          </div>
          <button
            disabled={payments.loading}
            onClick={() => void payments.refresh()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {payments.myTransactions.length === 0 ? (
          <div className="empty-copy">
            No payment transactions have been recorded yet.
          </div>
        ) : (
          <div className="cloud-payment-history">
            {payments.myTransactions.map((transaction) => (
              <article key={transaction.id}>
                <div>
                  <strong>
                    {transaction.direction === "credit"
                      ? "Payment received"
                      : "Refund or adjustment"}
                  </strong>
                  <span>
                    {formatDate(transaction.occurred_at)} ·{" "}
                    {transaction.method}
                  </span>
                  {transaction.note && <p>{transaction.note}</p>}
                </div>
                <strong
                  className={
                    transaction.direction === "credit"
                      ? "payment-credit"
                      : "payment-debit"
                  }
                >
                  {transaction.direction === "credit" ? "+" : "-"}
                  {dollars(transaction.amount_cents)}
                </strong>
              </article>
            ))}
          </div>
        )}

        {payments.error && (
          <div className="generator-message error">
            {payments.error}
          </div>
        )}
      </section>
    </div>
  );
}
