import { useMemo, useState } from "react";
import type {
  CloudPaymentAccount,
  CloudPaymentDirection,
  CloudPaymentMethod,
  CloudPaymentState,
  CloudPaymentTransaction,
} from "../../types/cloud";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function dollars(cents: number): string {
  return currency.format(cents / 100);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseAmountToCents(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100);
}

export function CloudPaymentLedgerPanel({
  payments,
  currentWeek,
}: {
  payments: CloudPaymentState;
  currentWeek: number;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] =
    useState<CloudPaymentAccount | null>(null);
  const [amount, setAmount] = useState("3");
  const [direction, setDirection] =
    useState<CloudPaymentDirection>("credit");
  const [method, setMethod] =
    useState<CloudPaymentMethod>("cash");
  const [occurredAt, setOccurredAt] = useState(today());
  const [note, setNote] = useState("");
  const [transactions, setTransactions] = useState<
    CloudPaymentTransaction[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const filteredAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return payments.commissionerAccounts;
    }

    return payments.commissionerAccounts.filter(
      (account) =>
        account.player_name.toLowerCase().includes(term) ||
        String(account.schedule_number ?? "").includes(term),
    );
  }, [payments.commissionerAccounts, search]);

  const collected = payments.commissionerAccounts.reduce(
    (sum, account) => sum + account.amount_paid_cents,
    0,
  );
  const claimedSeasonDue = payments.commissionerAccounts.reduce(
    (sum, account) => sum + account.season_amount_due_cents,
    0,
  );
  const claimedDueToDate = payments.commissionerAccounts.reduce(
    (sum, account) =>
      sum + account.amount_due_through_current_week_cents,
    0,
  );
  const behindCount = payments.commissionerAccounts.filter(
    (account) => account.payment_status === "behind",
  ).length;

  const chooseAccount = async (account: CloudPaymentAccount) => {
    setSelected(account);
    setMessage("");
    setError("");
    setTransactions([]);

    try {
      setTransactions(await payments.loadTransactions(account.uid));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The player's payment history could not be loaded.",
      );
    }
  };

  const record = async () => {
    if (!selected || selected.schedule_number === null) {
      setError("Choose a claimed player.");
      return;
    }

    const amountCents = parseAmountToCents(amount);

    if (amountCents <= 0) {
      setError("Enter a payment amount greater than $0.");
      return;
    }

    setBusy(true);
    setMessage("");
    setError("");

    try {
      await payments.recordPayment({
        uid: selected.uid,
        player_name: selected.player_name,
        schedule_number: selected.schedule_number,
        amount_cents: amountCents,
        direction,
        method,
        note,
        occurred_at: occurredAt,
      });
      setMessage(
        `${direction === "credit" ? "Payment" : "Adjustment"} recorded for ${selected.player_name}.`,
      );
      setTransactions(
        await payments.loadTransactions(selected.uid),
      );
      setAmount("3");
      setNote("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The payment transaction could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-card cloud-payment-ledger">
      <div className="generator-heading">
        <div>
          <p className="eyebrow">Package 6</p>
          <h2>Firebase Payment Ledger</h2>
          <p>
            Record player payments, refunds, and corrections without
            deleting the original transaction history.
          </p>
        </div>
        <span className="generator-status locked">
          Week {currentWeek}
        </span>
      </div>

      <div className="cloud-payment-summary">
        <div>
          <small>Collected</small>
          <strong>{dollars(collected)}</strong>
        </div>
        <div>
          <small>Claimed-player season dues</small>
          <strong>{dollars(claimedSeasonDue)}</strong>
        </div>
        <div>
          <small>Due through Week {currentWeek}</small>
          <strong>{dollars(claimedDueToDate)}</strong>
        </div>
        <div>
          <small>Players behind</small>
          <strong>{behindCount}</strong>
        </div>
      </div>

      <div className="payment-ledger-toolbar">
        <label>
          Find player or number
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search claimed players"
            value={search}
          />
        </label>
        <button
          disabled={payments.loading}
          onClick={() => void payments.refresh()}
          type="button"
        >
          Refresh Ledger
        </button>
      </div>

      {payments.commissionerAccounts.length === 0 ? (
        <div className="generator-note">
          No schedule numbers have been claimed yet. Payment accounts
          appear automatically after players claim a number.
        </div>
      ) : (
        <div className="payment-account-grid">
          {filteredAccounts.map((account) => (
            <button
              className={`payment-account-card ${
                selected?.uid === account.uid ? "selected" : ""
              }`}
              key={account.uid}
              onClick={() => void chooseAccount(account)}
              type="button"
            >
              <div>
                <small>
                  Schedule #{account.schedule_number ?? "—"}
                </small>
                <strong>{account.player_name}</strong>
              </div>
              <div>
                <strong>{dollars(account.amount_paid_cents)}</strong>
                <span
                  className={
                    account.payment_status === "current"
                      ? "payment-current"
                      : "payment-behind"
                  }
                >
                  {account.payment_status === "current"
                    ? "Current"
                    : `${dollars(account.amount_behind_cents)} behind`}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && selected.schedule_number !== null && (
        <div className="payment-entry-panel">
          <div className="section-heading">
            <h2>Record Transaction</h2>
            <p>
              {selected.player_name} · Schedule #
              {selected.schedule_number}
            </p>
          </div>

          <div className="payment-entry-grid">
            <label>
              Transaction
              <select
                onChange={(event) =>
                  setDirection(
                    event.target.value as CloudPaymentDirection,
                  )
                }
                value={direction}
              >
                <option value="credit">Payment received</option>
                <option value="debit">
                  Refund / negative adjustment
                </option>
              </select>
            </label>

            <label>
              Amount
              <input
                inputMode="decimal"
                min="0.01"
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </label>

            <label>
              Method
              <select
                onChange={(event) =>
                  setMethod(
                    event.target.value as CloudPaymentMethod,
                  )
                }
                value={method}
              >
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="venmo">Venmo</option>
                <option value="paypal">PayPal</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label>
              Payment date
              <input
                onChange={(event) =>
                  setOccurredAt(event.target.value)
                }
                type="date"
                value={occurredAt}
              />
            </label>
          </div>

          <label className="payment-note-field">
            Optional note
            <textarea
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Cash payment, correction reason, or other note"
              rows={3}
              value={note}
            />
          </label>

          <button
            className="generator-primary payment-save-button"
            disabled={busy}
            onClick={() => void record()}
            type="button"
          >
            {busy
              ? "Saving…"
              : direction === "credit"
                ? "Record Payment"
                : "Record Refund / Adjustment"}
          </button>

          <div className="selected-payment-history">
            <h3>Recent transactions</h3>
            {transactions.length === 0 ? (
              <p>No transactions recorded for this player.</p>
            ) : (
              transactions.slice(0, 8).map((transaction) => (
                <article key={transaction.id}>
                  <div>
                    <strong>
                      {transaction.direction === "credit"
                        ? "Payment"
                        : "Refund / adjustment"}
                    </strong>
                    <span>
                      {transaction.occurred_at} · {transaction.method}
                    </span>
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
              ))
            )}
          </div>
        </div>
      )}

      {message && <div className="generator-message">{message}</div>}
      {(error || payments.error) && (
        <div className="generator-message error">
          {error || payments.error}
        </div>
      )}
    </section>
  );
}
