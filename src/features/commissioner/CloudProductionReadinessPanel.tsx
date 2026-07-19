import { useMemo, useState } from "react";
import type {
  CloudCommissionerTeamState,
  CloudEnrollmentState,
  CloudPaymentState,
  CloudRole,
  CloudScoringState,
} from "../../types/cloud";

type ReadinessFilter =
  | "all"
  | "attention"
  | "pending"
  | "number"
  | "payment"
  | "ready";

interface PlayerReadinessRow {
  key: string;
  uid: string | null;
  displayName: string;
  email: string;
  role: CloudRole;
  invited: boolean;
  inviteCount: number;
  pendingInvite: boolean;
  signedIn: boolean;
  scheduleNumber: number | null;
  amountPaidCents: number;
  amountDueCents: number;
  paymentCurrent: boolean;
  paidInFull: boolean;
  ready: boolean;
  attention: string[];
}

interface ReadinessCheck {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  blocker: boolean;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function roleLabel(role: CloudRole): string {
  if (role === "primary_commissioner") {
    return "Primary Commissioner";
  }

  if (role === "co_commissioner") {
    return "Backup Commissioner";
  }

  return "Player";
}

function statusText(row: PlayerReadinessRow): string {
  if (row.ready) {
    return "Ready";
  }

  if (row.pendingInvite) {
    return "Needs sign-in";
  }

  if (!row.signedIn) {
    return "Needs invitation";
  }

  if (!row.scheduleNumber) {
    return "Needs number";
  }

  if (!row.paymentCurrent) {
    return "Needs payment";
  }

  return "Review";
}

export function CloudProductionReadinessPanel({
  currentRole,
  cloud,
  team,
  payments,
  scoring,
}: {
  currentRole: CloudRole;
  cloud: CloudEnrollmentState;
  team: CloudCommissionerTeamState;
  payments: CloudPaymentState;
  scoring: CloudScoringState;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReadinessFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dashboard = useMemo(() => {
    const usersByUid = new Map(
      team.users.map((user) => [user.uid, user]),
    );
    const usersByEmail = new Map(
      team.users
        .filter((user) => Boolean(user.email))
        .map((user) => [normalizeEmail(user.email), user]),
    );
    const invitesByEmail = new Map<
      string,
      CloudCommissionerTeamState["invites"]
    >();

    team.invites.forEach((invite) => {
      const email = normalizeEmail(invite.email);
      const existing = invitesByEmail.get(email) ?? [];
      existing.push(invite);
      invitesByEmail.set(email, existing);
    });

    const accountsByUid = new Map(
      payments.commissionerAccounts.map((account) => [
        account.uid,
        account,
      ]),
    );
    const accountByEmail = new Map(
      payments.commissionerAccounts
        .map((account) => {
          const user = usersByUid.get(account.uid);
          return user?.email
            ? [normalizeEmail(user.email), account] as const
            : null;
        })
        .filter(
          (entry): entry is NonNullable<typeof entry> =>
            entry !== null,
        ),
    );

    const allEmails = new Set<string>([
      ...usersByEmail.keys(),
      ...invitesByEmail.keys(),
    ]);

    const rows: PlayerReadinessRow[] = [];

    allEmails.forEach((email) => {
      const user = usersByEmail.get(email);
      const invites = invitesByEmail.get(email) ?? [];
      const linkedInvite = invites.find((invite) => invite.linked_uid);
      const uid = user?.uid ?? linkedInvite?.linked_uid ?? null;
      const account = uid
        ? accountsByUid.get(uid)
        : accountByEmail.get(email);
      const role = user?.role ?? "player";
      const invited = invites.length > 0;
      const signedIn = Boolean(user || linkedInvite?.linked_uid);
      const pendingInvite = invited && !signedIn;
      const scheduleNumber = account?.schedule_number ?? null;
      const paymentCurrent = account
        ? account.payment_status === "current"
        : false;
      const paidInFull = account
        ? account.remaining_season_balance_cents === 0
        : false;
      const attention: string[] = [];

      if (role === "player" && !invited && signedIn) {
        attention.push("No invitation record");
      }

      if (invites.length > 1) {
        attention.push(`${invites.length} invitation records`);
      }

      if (!signedIn) {
        attention.push("Has not signed in");
      }

      if (signedIn && !scheduleNumber) {
        attention.push("No schedule number");
      }

      if (scheduleNumber && !paymentCurrent) {
        attention.push("Payment behind");
      }

      rows.push({
        key: email || uid || `unknown-${rows.length}`,
        uid,
        displayName:
          user?.display_name ??
          invites[0]?.display_name ??
          account?.player_name ??
          "Player",
        email,
        role,
        invited,
        inviteCount: invites.length,
        pendingInvite,
        signedIn,
        scheduleNumber,
        amountPaidCents: account?.amount_paid_cents ?? 0,
        amountDueCents:
          account?.amount_due_through_current_week_cents ?? 0,
        paymentCurrent,
        paidInFull,
        ready: signedIn && Boolean(scheduleNumber) && paymentCurrent,
        attention,
      });
    });

    payments.commissionerAccounts.forEach((account) => {
      if (rows.some((row) => row.uid === account.uid)) {
        return;
      }

      rows.push({
        key: account.uid,
        uid: account.uid,
        displayName: account.player_name,
        email: "",
        role: "player",
        invited: false,
        inviteCount: 0,
        pendingInvite: false,
        signedIn: usersByUid.has(account.uid),
        scheduleNumber: account.schedule_number,
        amountPaidCents: account.amount_paid_cents,
        amountDueCents:
          account.amount_due_through_current_week_cents,
        paymentCurrent: account.payment_status === "current",
        paidInFull: account.remaining_season_balance_cents === 0,
        ready:
          usersByUid.has(account.uid) &&
          Boolean(account.schedule_number) &&
          account.payment_status === "current",
        attention: [
          "Claim is not matched to an email directory record",
        ],
      });
    });

    rows.sort((a, b) => {
      const aNumber = a.scheduleNumber ?? 99;
      const bNumber = b.scheduleNumber ?? 99;

      if (aNumber !== bNumber) {
        return aNumber - bNumber;
      }

      return a.displayName.localeCompare(b.displayName);
    });

    const duplicateEmails = [...invitesByEmail.entries()]
      .filter(([, invites]) => invites.length > 1)
      .map(([email]) => email);
    const scheduleCounts = new Map<number, number>();

    payments.commissionerAccounts.forEach((account) => {
      if (account.schedule_number) {
        scheduleCounts.set(
          account.schedule_number,
          (scheduleCounts.get(account.schedule_number) ?? 0) + 1,
        );
      }
    });

    const duplicateSchedules = [...scheduleCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([number]) => number);
    const integrityWarnings = [
      ...duplicateEmails.map(
        (email) => `Duplicate invitations for ${email}`,
      ),
      ...duplicateSchedules.map(
        (number) => `Schedule #${number} appears more than once`,
      ),
      ...rows
        .filter((row) => row.attention.includes(
          "Claim is not matched to an email directory record",
        ))
        .map((row) => `${row.displayName} has an unmatched claim`),
    ];

    const signedInCount = rows.filter((row) => row.signedIn).length;
    const paymentCurrentCount = payments.commissionerAccounts.filter(
      (account) => account.payment_status === "current",
    ).length;
    const paidInFullCount = payments.commissionerAccounts.filter(
      (account) => account.remaining_season_balance_cents === 0,
    ).length;
    const readyPlayerCount = rows.filter((row) => row.ready).length;
    const bothBackups = Boolean(
      team.backups.backup1 && team.backups.backup2,
    );
    const nflTeamCount = new Set(
      scoring.scores.map((score) => score.team_code),
    ).size;
    const paymentDirectoryMatchesClaims =
      payments.commissionerAccounts.length === cloud.claimedCount;
    const allClaimsComplete = cloud.claimedCount === 32;

    const checks: ReadinessCheck[] = [
      {
        id: "primary",
        label: "Primary Commissioner",
        detail: team.primary
          ? `${team.primary.display_name} has full control.`
          : "Primary Commissioner is missing.",
        passed: Boolean(team.primary),
        blocker: true,
      },
      {
        id: "backups",
        label: "Two Backup Commissioners",
        detail: bothBackups
          ? "Both backup positions are assigned."
          : `${Number(Boolean(team.backups.backup1)) + Number(Boolean(team.backups.backup2))}/2 backup positions assigned.`,
        passed: bothBackups,
        blocker: true,
      },
      {
        id: "schedule",
        label: "Official Schedule Published",
        detail: cloud.poolStatus?.schedule_locked
          ? "The 32 hidden schedule lines are locked in Firebase."
          : "Publish and lock the official schedule.",
        passed: Boolean(cloud.poolStatus?.schedule_locked),
        blocker: true,
      },
      {
        id: "claims",
        label: "All 32 Numbers Claimed",
        detail: `${cloud.claimedCount}/32 schedule numbers are claimed.`,
        passed: allClaimsComplete,
        blocker: true,
      },
      {
        id: "selection",
        label: "Number Selection Closed",
        detail: cloud.poolStatus?.enrollment_open
          ? "Number selection is still open."
          : "Number selection is closed.",
        passed:
          allClaimsComplete &&
          !cloud.poolStatus?.enrollment_open,
        blocker: true,
      },
      {
        id: "directory",
        label: "Claims Match Player Directory",
        detail: paymentDirectoryMatchesClaims
          ? "Every claim is represented in the commissioner ledger."
          : `${payments.commissionerAccounts.length} ledger accounts for ${cloud.claimedCount} claims.`,
        passed: paymentDirectoryMatchesClaims,
        blocker: true,
      },
      {
        id: "nfl",
        label: "NFL Week Data Loaded",
        detail:
          nflTeamCount >= 32
            ? `${nflTeamCount} NFL teams are loaded for Week ${scoring.currentWeek}.`
            : `${nflTeamCount}/32 NFL teams loaded for Week ${scoring.currentWeek}.`,
        passed: nflTeamCount >= 32 && !scoring.providerError,
        blocker: true,
      },
      {
        id: "integrity",
        label: "No Duplicate or Link Conflicts",
        detail:
          integrityWarnings.length === 0
            ? "No duplicate emails, numbers, or unmatched claims found."
            : `${integrityWarnings.length} integrity warning${integrityWarnings.length === 1 ? "" : "s"} need review.`,
        passed: integrityWarnings.length === 0,
        blocker: true,
      },
      {
        id: "payments",
        label: "Week Payment Review",
        detail: `${paymentCurrentCount}/${cloud.claimedCount} claimed players are current through Week ${scoring.currentWeek}.`,
        passed:
          cloud.claimedCount > 0 &&
          paymentCurrentCount === cloud.claimedCount,
        blocker: false,
      },
    ];

    const blockers = checks.filter(
      (check) => check.blocker && !check.passed,
    );

    return {
      rows,
      checks,
      blockers,
      integrityWarnings,
      signedInCount,
      paymentCurrentCount,
      paidInFullCount,
      readyPlayerCount,
      inviteCount: team.invites.length,
      representedCount: rows.filter(
        (row) => row.role === "player" || row.scheduleNumber,
      ).length,
      isReady: blockers.length === 0,
    };
  }, [cloud, payments.commissionerAccounts, scoring, team]);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();

    return dashboard.rows.filter((row) => {
      const matchesSearch =
        !search ||
        row.displayName.toLowerCase().includes(search) ||
        row.email.toLowerCase().includes(search) ||
        String(row.scheduleNumber ?? "").includes(search);

      if (!matchesSearch) {
        return false;
      }

      if (filter === "attention") {
        return row.attention.length > 0;
      }

      if (filter === "pending") {
        return !row.signedIn;
      }

      if (filter === "number") {
        return row.signedIn && !row.scheduleNumber;
      }

      if (filter === "payment") {
        return Boolean(row.scheduleNumber) && !row.paymentCurrent;
      }

      if (filter === "ready") {
        return row.ready;
      }

      return true;
    });
  }, [dashboard.rows, filter, query]);

  const refreshAll = async () => {
    setRefreshing(true);
    setMessage("");
    setError("");

    try {
      await Promise.all([
        cloud.refresh(),
        team.refresh(),
        payments.refresh(),
        scoring.refresh(),
      ]);
      setMessage("Onboarding and production status refreshed.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The production readiness status could not be refreshed.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const loading =
    team.loading || payments.loading || scoring.loading || cloud.loading;

  return (
    <section className="section-card production-readiness-panel">
      <div className="generator-heading readiness-heading">
        <div>
          <p className="eyebrow">Package 12</p>
          <h2>Player Onboarding and Production Readiness</h2>
          <p>
            See who still needs an invitation, sign-in, number, or payment,
            and confirm the live pool is ready for Week 1.
          </p>
        </div>
        <span
          className={`generator-status readiness-status ${
            dashboard.isReady ? "locked" : ""
          }`}
        >
          {dashboard.isReady
            ? "Ready for Season"
            : `${dashboard.blockers.length} blocker${
                dashboard.blockers.length === 1 ? "" : "s"
              }`}
        </span>
      </div>

      <div className="readiness-summary-grid">
        <div>
          <small>Invitations</small>
          <strong>{dashboard.inviteCount}</strong>
          <span>records sent</span>
        </div>
        <div>
          <small>Signed in</small>
          <strong>{dashboard.signedInCount}</strong>
          <span>Firebase accounts</span>
        </div>
        <div>
          <small>Numbers</small>
          <strong>{cloud.claimedCount}/32</strong>
          <span>claimed lines</span>
        </div>
        <div>
          <small>Payment current</small>
          <strong>{dashboard.paymentCurrentCount}</strong>
          <span>through Week {scoring.currentWeek}</span>
        </div>
        <div>
          <small>Paid in full</small>
          <strong>{dashboard.paidInFullCount}</strong>
          <span>of {cloud.claimedCount} claimed</span>
        </div>
        <div>
          <small>Player ready</small>
          <strong>{dashboard.readyPlayerCount}</strong>
          <span>signed in · claimed · current</span>
        </div>
      </div>

      <div className="readiness-toolbar">
        <label>
          Search players
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or number"
            type="search"
            value={query}
          />
        </label>
        <label>
          Status
          <select
            onChange={(event) =>
              setFilter(event.target.value as ReadinessFilter)
            }
            value={filter}
          >
            <option value="all">All known players</option>
            <option value="attention">Needs attention</option>
            <option value="pending">Needs sign-in</option>
            <option value="number">Needs number</option>
            <option value="payment">Needs payment</option>
            <option value="ready">Ready</option>
          </select>
        </label>
        <button
          disabled={refreshing}
          onClick={() => void refreshAll()}
          type="button"
        >
          {refreshing ? "Refreshing…" : "Refresh All"}
        </button>
      </div>

      <div className="production-check-grid">
        {dashboard.checks.map((check) => (
          <article
            className={`${check.passed ? "passed" : "waiting"} ${
              check.blocker ? "required" : "advisory"
            }`}
            key={check.id}
          >
            <span aria-hidden="true">
              {check.passed ? "✓" : check.blocker ? "!" : "i"}
            </span>
            <div>
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </div>
          </article>
        ))}
      </div>

      {dashboard.integrityWarnings.length > 0 && (
        <div className="readiness-warning-list">
          <strong>Integrity warnings</strong>
          {dashboard.integrityWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      <div className="readiness-list-heading">
        <div>
          <h3>Player readiness</h3>
          <p>
            Showing {filteredRows.length} of {dashboard.rows.length} known
            accounts or invitations. {Math.max(0, 32 - cloud.claimedCount)}
            schedule numbers remain open.
          </p>
        </div>
        <span>{roleLabel(currentRole)} view</span>
      </div>

      <div className="readiness-player-list">
        {filteredRows.map((row) => (
          <article key={row.key}>
            <div className="readiness-player-main">
              <div className="readiness-player-title">
                <strong>{row.displayName}</strong>
                <span className={row.ready ? "ready" : "attention"}>
                  {statusText(row)}
                </span>
              </div>
              <span>{row.email || "Email unavailable"}</span>
              <small>{roleLabel(row.role)}</small>
            </div>

            <div className="readiness-player-progress">
              <span className={row.invited ? "done" : ""}>
                Invite
              </span>
              <span className={row.signedIn ? "done" : ""}>
                Sign-in
              </span>
              <span className={row.scheduleNumber ? "done" : ""}>
                {row.scheduleNumber
                  ? `#${row.scheduleNumber}`
                  : "Number"}
              </span>
              <span className={row.paymentCurrent ? "done" : ""}>
                Payment
              </span>
            </div>

            <div className="readiness-player-payment">
              <strong>
                {row.scheduleNumber
                  ? money(row.amountPaidCents)
                  : "—"}
              </strong>
              <small>
                {row.scheduleNumber
                  ? `${money(row.amountDueCents)} due through current week`
                  : "No claimed line"}
              </small>
            </div>

            {row.attention.length > 0 && (
              <div className="readiness-player-notes">
                {row.attention.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </div>
            )}
          </article>
        ))}

        {!loading && filteredRows.length === 0 && (
          <div className="readiness-empty">
            No players match the selected search and status filter.
          </div>
        )}
      </div>

      {loading && (
        <div className="generator-message">
          Loading Firebase production status…
        </div>
      )}
      {message && <div className="generator-message">{message}</div>}
      {(error || team.error || payments.error || scoring.error || cloud.error) && (
        <div className="generator-message error">
          {error || team.error || payments.error || scoring.error || cloud.error}
        </div>
      )}
    </section>
  );
}
