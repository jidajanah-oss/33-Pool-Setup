import { useMemo, useState } from "react";
import "./App.css";
import { rules } from "./data/demoData";
import { CloudAuthGate } from "./features/auth/CloudAuthGate";
import { useCloudAuth } from "./features/auth/useCloudAuth";
import { CloudCommissionerPanel } from "./features/commissioner/CloudCommissionerPanel";
import { CloudPaymentLedgerPanel } from "./features/commissioner/CloudPaymentLedgerPanel";
import { ScheduleGeneratorPanel } from "./features/commissioner/ScheduleGeneratorPanel";
import {
  CloudMySchedule,
  CloudNumberBoard,
  CloudWeeklyBoard,
} from "./features/enrollment/CloudEnrollmentScreens";
import { useCloudEnrollment } from "./features/enrollment/useCloudEnrollment";
import { CloudPaymentsScreen } from "./features/payments/CloudPaymentsScreen";
import { useCloudPayments } from "./features/payments/useCloudPayments";
import type { AppScreen } from "./types/pool";

const nav: Array<{ id: AppScreen; label: string }> = [
  { id: "home", label: "Home" },
  { id: "numbers", label: "Choose Number" },
  { id: "schedule", label: "My Schedule" },
  { id: "weekly", label: "Weekly Board" },
  { id: "pot", label: "Pot Tracker" },
  { id: "payments", label: "Payments" },
  { id: "rules", label: "Rules" },
  { id: "commissioner", label: "Commissioner" },
];

export default function CloudApp() {
  const auth = useCloudAuth();
  const cloud = useCloudEnrollment(auth.profile);
  const [screen, setScreen] = useState<AppScreen>("home");
  const canOpenCommissioner =
    auth.profile?.role === "primary_commissioner" ||
    auth.profile?.role === "co_commissioner";
  const currentWeek = cloud.poolStatus?.current_week ?? 1;
  const payments = useCloudPayments(
    auth.profile,
    currentWeek,
    canOpenCommissioner,
  );
  const title = useMemo(
    () =>
      nav.find((item) => item.id === screen)?.label ?? "33 Pool",
    [screen],
  );
  const initials = (auth.profile?.display_name ?? "P")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <CloudAuthGate auth={auth}>
      <div className="app-shell">
        <aside className="desktop-sidebar">
          <div className="desktop-brand">
            <div className="brand-mark">
              <span>33</span>
            </div>
            <div>
              <strong>33 Pool</strong>
              <small>Firebase Season Tracker</small>
            </div>
          </div>

          <nav>
            {nav
              .filter(
                (item) =>
                  item.id !== "commissioner" ||
                  canOpenCommissioner,
              )
              .map((item) => (
                <button
                  className={screen === item.id ? "active" : ""}
                  key={item.id}
                  onClick={() => setScreen(item.id)}
                  type="button"
                >
                  <span />
                  {item.label}
                </button>
              ))}
          </nav>

          <div className="sidebar-card">
            <small>2026 Cloud Enrollment</small>
            <strong>{cloud.claimedCount} of 32 claimed</strong>
            <div className="progress-track">
              <span
                style={{
                  width: `${(cloud.claimedCount / 32) * 100}%`,
                }}
              />
            </div>
          </div>
        </aside>

        <div className="app-stage">
          <header className="mobile-header">
            <button
              className="brand-button"
              onClick={() => setScreen("more")}
              type="button"
            >
              <div className="brand-mark">
                <span>33</span>
              </div>
            </button>
            <div>
              <small>33 Pool Setup</small>
              <strong>{title}</strong>
            </div>
            <div className="header-number">
              {cloud.ownClaim
                ? `#${cloud.ownClaim.schedule_number}`
                : "Open"}
            </div>
          </header>

          <header className="desktop-header">
            <div>
              <p className="eyebrow">{title}</p>
              <h1>33 Pool Setup</h1>
            </div>
            <div className="profile-chip">
              <span>{initials}</span>
              <div>
                <strong>{auth.profile?.display_name}</strong>
                <small>
                  {cloud.ownClaim
                    ? `Schedule #${cloud.ownClaim.schedule_number}`
                    : auth.profile?.role.replaceAll("_", " ")}
                </small>
              </div>
            </div>
          </header>

          <main className="app-content">
            {screen === "home" && (
              <CloudHome
                cloud={cloud}
                name={auth.profile?.display_name ?? "Player"}
                onNavigate={setScreen}
                payments={payments}
              />
            )}
            {screen === "numbers" && auth.profile && (
              <CloudNumberBoard
                cloud={cloud}
                profile={auth.profile}
              />
            )}
            {screen === "schedule" && auth.profile && (
              <CloudMySchedule
                cloud={cloud}
                profile={auth.profile}
              />
            )}
            {screen === "weekly" && (
              <CloudWeeklyBoard cloud={cloud} />
            )}
            {screen === "pot" && <CloudPot />}
            {screen === "payments" && auth.profile && (
              <CloudPaymentsScreen
                currentWeek={currentWeek}
                payments={payments}
                profile={auth.profile}
              />
            )}
            {screen === "rules" && <CloudRules />}
            {screen === "commissioner" &&
              canOpenCommissioner && (
                <div className="screen-stack">
                  <CloudCommissionerPanel
                    auth={auth}
                    cloud={cloud}
                  />
                  <CloudPaymentLedgerPanel
                    currentWeek={currentWeek}
                    payments={payments}
                  />
                  <ScheduleGeneratorPanel />
                </div>
              )}
            {screen === "more" && (
              <CloudMore
                auth={auth}
                canOpenCommissioner={canOpenCommissioner}
                cloud={cloud}
                onNavigate={setScreen}
                payments={payments}
              />
            )}
          </main>

          <nav className="phone-tab-bar">
            <button
              className={screen === "home" ? "active" : ""}
              onClick={() => setScreen("home")}
              type="button"
            >
              <span className="cloud-tab-icon">⌂</span>
              <span>Home</span>
            </button>
            <button
              className={screen === "schedule" ? "active" : ""}
              onClick={() => setScreen("schedule")}
              type="button"
            >
              <span className="cloud-tab-icon">18</span>
              <span>My Line</span>
            </button>
            <button
              className={screen === "weekly" ? "active" : ""}
              onClick={() => setScreen("weekly")}
              type="button"
            >
              <span className="cloud-tab-icon">W</span>
              <span>Week</span>
            </button>
            <button
              className={screen === "pot" ? "active" : ""}
              onClick={() => setScreen("pot")}
              type="button"
            >
              <span className="cloud-tab-icon">$</span>
              <span>Pot</span>
            </button>
            <button
              className={
                [
                  "numbers",
                  "payments",
                  "rules",
                  "commissioner",
                  "more",
                ].includes(screen)
                  ? "active"
                  : ""
              }
              onClick={() => setScreen("more")}
              type="button"
            >
              <span className="cloud-tab-icon">•••</span>
              <span>More</span>
            </button>
          </nav>
        </div>
      </div>
    </CloudAuthGate>
  );
}

function CloudHome({
  cloud,
  name,
  onNavigate,
  payments,
}: {
  cloud: ReturnType<typeof useCloudEnrollment>;
  name: string;
  onNavigate: (screen: AppScreen) => void;
  payments: ReturnType<typeof useCloudPayments>;
}) {
  const first = cloud.ownSchedule.find(
    (assignment) => assignment.week === 1,
  );
  const account = payments.myAccount;

  return (
    <div className="screen-stack">
      <section className="score-hero">
        <div className="hero-topline">
          <span>Before Week 1</span>
          <span className="live-dot">Firebase connected</span>
        </div>
        <p>
          {cloud.ownClaim
            ? `${name}'s Week 1 assignment`
            : "Your hidden schedule"}
        </p>
        <div className="hero-team">
          <div className="team-roundel">
            {first?.teamCode ?? "?"}
          </div>
          <div>
            <h2>{first?.teamName ?? "Choose a number"}</h2>
            <span>
              {first?.isBye
                ? "Your pool bye"
                : cloud.ownClaim
                  ? "Schedule revealed"
                  : "No team preview before confirmation"}
            </span>
          </div>
          <strong>{first?.isBye ? "BYE" : "33"}</strong>
        </div>
        <div className="target-row">
          <span>
            {cloud.ownClaim
              ? `Schedule #${cloud.ownClaim.schedule_number} confirmed`
              : "Select any available number"}
          </span>
          <button
            className="hero-action-button"
            onClick={() =>
              onNavigate(
                cloud.ownClaim ? "schedule" : "numbers",
              )
            }
            type="button"
          >
            {cloud.ownClaim ? "View line" : "Choose #"}
          </button>
        </div>
      </section>

      <section className="mobile-stat-grid">
        <Stat
          label="Your number"
          value={
            cloud.ownClaim
              ? `#${cloud.ownClaim.schedule_number}`
              : "Open"
          }
          helper={
            cloud.ownClaim
              ? "Firebase confirmed"
              : "Choose before Week 1"
          }
        />
        <Stat
          label="Enrollment"
          value={`${cloud.claimedCount}/32`}
          helper={`${32 - cloud.claimedCount} available`}
        />
        <Stat
          label="Payment"
          value={
            account?.payment_status === "behind"
              ? "Behind"
              : "Current"
          }
          helper={
            account
              ? `${(account.amount_paid_cents / 100).toLocaleString(
                  "en-US",
                  {
                    style: "currency",
                    currency: "USD",
                  },
                )} paid`
              : "Loading ledger"
          }
        />
        <Stat label="Target" value="33" helper="Final score only" />
      </section>

      <section className="section-card">
        <h2>Firebase status</h2>
        <div className="cloud-status-grid">
          <div>
            <small>Schedule</small>
            <strong>
              {cloud.poolStatus?.schedule_locked
                ? "Published"
                : "Waiting"}
            </strong>
          </div>
          <div>
            <small>Selection</small>
            <strong>
              {cloud.poolStatus?.enrollment_open
                ? "Open"
                : "Closed"}
            </strong>
          </div>
          <div>
            <small>Season</small>
            <strong>2026</strong>
          </div>
          <div>
            <small>Account</small>
            <strong>Linked</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="stat-card">
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{helper}</span>
    </article>
  );
}

function CloudPot() {
  return (
    <div className="screen-stack">
      <section className="pot-hero">
        <p>Starting Week 1 pot</p>
        <strong>$96</strong>
        <span>$3 from all 32 players</span>
      </section>
      <section className="section-card">
        <h2>Cloud pot tracking comes next</h2>
        <p className="cloud-muted-copy">
          The Firebase payment ledger is now active. Live scores,
          rolling-pot accounting, and exact-33 payouts remain separate
          controlled packages.
        </p>
      </section>
    </div>
  );
}

function CloudRules() {
  return (
    <div className="screen-stack">
      <section className="rules-hero">
        <div className="brand-mark">
          <span>33</span>
        </div>
        <div>
          <small>Official pool rules</small>
          <strong>Final score of 33 wins</strong>
          <span>
            32 players · $3 per week · 18 paid weeks
          </span>
        </div>
      </section>
      <section className="rules-list">
        {rules.map((rule, index) => (
          <article key={rule}>
            <span>{index + 1}</span>
            <p>{rule}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function CloudMore({
  auth,
  cloud,
  canOpenCommissioner,
  onNavigate,
  payments,
}: {
  auth: ReturnType<typeof useCloudAuth>;
  cloud: ReturnType<typeof useCloudEnrollment>;
  canOpenCommissioner: boolean;
  onNavigate: (screen: AppScreen) => void;
  payments: ReturnType<typeof useCloudPayments>;
}) {
  return (
    <div className="screen-stack">
      <section className="profile-panel">
        <div className="profile-avatar">
          {(auth.profile?.display_name ?? "P")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div>
          <strong>{auth.profile?.display_name}</strong>
          <span>
            {cloud.ownClaim
              ? `Schedule #${cloud.ownClaim.schedule_number}`
              : auth.profile?.role.replaceAll("_", " ")}
          </span>
        </div>
      </section>

      <section className="more-grid">
        <More
          helper="Secure blind selection"
          label="Choose Number"
          onClick={() => onNavigate("numbers")}
          symbol="#"
        />
        <More
          helper={
            payments.myAccount
              ? `${payments.myAccount.payment_status} · Firebase ledger`
              : "Firebase balance and history"
          }
          label="Payments"
          onClick={() => onNavigate("payments")}
          symbol="$"
        />
        <More
          helper="Approved rules"
          label="Pool Rules"
          onClick={() => onNavigate("rules")}
          symbol="33"
        />
        {canOpenCommissioner && (
          <More
            helper="Protected Firebase controls"
            label="Commissioner"
            onClick={() => onNavigate("commissioner")}
            symbol="C"
          />
        )}
      </section>

      <section className="section-card">
        <button
          className="cloud-signout-button"
          onClick={() => void auth.signOut()}
          type="button"
        >
          Sign Out
        </button>
      </section>
    </div>
  );
}

function More({
  label,
  helper,
  symbol,
  onClick,
}: {
  label: string;
  helper: string;
  symbol: string;
  onClick: () => void;
}) {
  return (
    <button
      className="more-button"
      onClick={onClick}
      type="button"
    >
      <span>{symbol}</span>
      <div>
        <strong>{label}</strong>
        <small>{helper}</small>
      </div>
      <b>›</b>
    </button>
  );
}
