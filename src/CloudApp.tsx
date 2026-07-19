import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { OfficialLogo } from "./components/OfficialLogo";
import { rules } from "./data/demoData";
import { CloudAuthGate } from "./features/auth/CloudAuthGate";
import { useCloudAuth } from "./features/auth/useCloudAuth";
import { CloudCommissionerPanel } from "./features/commissioner/CloudCommissionerPanel";
import { CloudPullResetPanel } from "./features/commissioner/CloudPullResetPanel";
import { CloudInvitationsAndTeamPanel } from "./features/commissioner/CloudInvitationsAndTeamPanel";
import { CloudPaymentLedgerPanel } from "./features/commissioner/CloudPaymentLedgerPanel";
import { CloudScoringPanel } from "./features/commissioner/CloudScoringPanel";
import { ScheduleGeneratorPanel } from "./features/commissioner/ScheduleGeneratorPanel";
import {
  CloudMySchedule,
  CloudNumberBoard,
} from "./features/enrollment/CloudEnrollmentScreens";
import { useCloudEnrollment } from "./features/enrollment/useCloudEnrollment";
import { CloudPaymentsScreen } from "./features/payments/CloudPaymentsScreen";
import { useCloudPayments } from "./features/payments/useCloudPayments";
import { CloudPotScreen } from "./features/scoring/CloudPotScreen";
import { CloudWeeklyScoringBoard } from "./features/scoring/CloudWeeklyScoringBoard";
import { useCloudScoring } from "./features/scoring/useCloudScoring";
import { useCloudCommissionerTeam } from "./features/team/useCloudCommissionerTeam";
import type { AppScreen } from "./types/pool";
import { PRIMARY_COMMISSIONER_EMAIL } from "./services/cloudRoleService";

const nav: Array<{ id: AppScreen; label: string }> = [
  { id: "home", label: "Home" },
  { id: "numbers", label: "Choose Number" },
  { id: "schedule", label: "My Schedule" },
  { id: "weekly", label: "Weekly Board" },
  { id: "pot", label: "Pot Tracker" },
  { id: "payments", label: "Payments" },
  { id: "rules", label: "Rules" },
  { id: "commissioner", label: "Commissioner" },
  { id: "more", label: "More" },
];

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

function cloudRoleLabel(role: string | undefined): string {
  if (role === "primary_commissioner") {
    return "Primary Commissioner";
  }

  if (role === "co_commissioner") {
    return "Backup Commissioner";
  }

  return "Player";
}

function profileSubtitle(
  role: string | undefined,
  scheduleNumber: number | undefined,
): string {
  const roleLabel = cloudRoleLabel(role);

  if (role === "primary_commissioner" || role === "co_commissioner") {
    return scheduleNumber
      ? `${roleLabel} · Schedule #${scheduleNumber}`
      : roleLabel;
  }

  return scheduleNumber ? `Schedule #${scheduleNumber}` : roleLabel;
}

export default function CloudApp() {
  const auth = useCloudAuth();
  const cloud = useCloudEnrollment(auth.profile);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const isPrimaryEmail =
    auth.user?.email?.trim().toLowerCase() ===
    PRIMARY_COMMISSIONER_EMAIL;
  const canOpenCommissioner =
    isPrimaryEmail ||
    auth.profile?.role === "primary_commissioner" ||
    auth.profile?.role === "co_commissioner";
  const currentWeek = cloud.poolStatus?.current_week ?? 1;
  const payments = useCloudPayments(
    auth.profile,
    currentWeek,
    canOpenCommissioner,
  );
  const scoring = useCloudScoring(
    auth.profile,
    currentWeek,
    canOpenCommissioner,
  );
  const commissionerTeam = useCloudCommissionerTeam(auth.profile);
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

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean(
        (window.navigator as Navigator & { standalone?: boolean })
          .standalone,
      );
    const ios =
      /iPad|iPhone|iPod/.test(window.navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;

    setIsStandalone(standalone);
    setIsIos(ios);

    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const markInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener(
      "beforeinstallprompt",
      captureInstallPrompt,
    );
    window.addEventListener("appinstalled", markInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        captureInstallPrompt,
      );
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  useEffect(() => {
    if (screen === "home") {
      scoring.setSelectedWeek(currentWeek);
    }
  }, [currentWeek, screen]);

  const installApp = async (): Promise<void> => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  return (
    <CloudAuthGate auth={auth}>
      <div className="app-shell">
        <aside className="desktop-sidebar">
          <div className="desktop-brand">
            <div className="brand-mark">
              <OfficialLogo decorative />
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
            <div className="sidebar-account-summary">
              <small>Signed in as</small>
              <strong>{auth.profile?.display_name}</strong>
              <span>
                {profileSubtitle(
                  isPrimaryEmail
                    ? "primary_commissioner"
                    : auth.profile?.role,
                  cloud.ownClaim?.schedule_number,
                )}
              </span>
            </div>
            <button
              className="sidebar-signout-button"
              onClick={() => void auth.signOut()}
              type="button"
            >
              Sign Out
            </button>
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
              <OfficialLogo decorative />
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
                  {profileSubtitle(
                    isPrimaryEmail
                      ? "primary_commissioner"
                      : auth.profile?.role,
                    cloud.ownClaim?.schedule_number,
                  )}
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
                scoring={scoring}
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
              <CloudWeeklyScoringBoard
                cloud={cloud}
                scoring={scoring}
              />
            )}
            {screen === "pot" && (
              <CloudPotScreen scoring={scoring} />
            )}
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
                <div className="screen-stack commissioner-screen">
                  <CloudCommissionerPanel
                    auth={auth}
                    cloud={cloud}
                  />
                  {auth.profile && (
                    <CloudPullResetPanel
                      claimedCount={cloud.claimedCount}
                      currentRole={
                        isPrimaryEmail
                          ? "primary_commissioner"
                          : auth.profile.role
                      }
                      onResetComplete={cloud.refresh}
                      poolStatus={cloud.poolStatus}
                    />
                  )}
                  {auth.profile && (
                    <CloudInvitationsAndTeamPanel
                      currentRole={auth.profile.role}
                      team={commissionerTeam}
                    />
                  )}
                  <CloudScoringPanel
                    onPoolRefresh={cloud.refresh}
                    scoring={scoring}
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
                installPromptAvailable={Boolean(installPrompt)}
                isIos={isIos}
                isStandalone={isStandalone}
                onInstall={installApp}
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
              <span className="cloud-tab-icon">
                {cloud.ownClaim?.schedule_number ?? "#"}
              </span>
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

function cleanNflStatusDetail(
  value: string | undefined,
): string {
  return (value ?? "")
    .replace(/\bSTATUS_[A-Z0-9_]+\b/g, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

function CloudHome({
  cloud,
  name,
  onNavigate,
  payments,
  scoring,
}: {
  cloud: ReturnType<typeof useCloudEnrollment>;
  name: string;
  onNavigate: (screen: AppScreen) => void;
  payments: ReturnType<typeof useCloudPayments>;
  scoring: ReturnType<typeof useCloudScoring>;
}) {
  const currentAssignment = cloud.ownSchedule.find(
    (assignment) => assignment.week === scoring.currentWeek,
  );
  const currentScore =
    scoring.selectedWeek === scoring.currentWeek
      ? scoring.scores.find(
          (score) =>
            score.team_code === currentAssignment?.teamCode,
        )
      : undefined;
  const account = payments.myAccount;

  return (
    <div className="screen-stack">
      <section className="score-hero">
        <div className="hero-topline">
          <span>Week {scoring.currentWeek}</span>
          <span className="live-dot">NFL sync active</span>
        </div>
        <p>
          {cloud.ownClaim
            ? `${name}'s Week ${scoring.currentWeek} assignment`
            : "Your hidden schedule"}
        </p>
        <div className="hero-team">
          <div className="team-roundel">
            {currentAssignment?.teamCode ?? "?"}
          </div>
          <div>
            <h2>{currentAssignment?.teamName ?? "Choose a number"}</h2>
            <span>
              {currentAssignment?.isBye
                ? "Your pool bye"
                : currentScore?.status === "live"
                  ? `Live score: ${currentScore.score ?? 0}`
                  : currentScore?.status === "final"
                    ? `Final score: ${currentScore.score}`
                    : currentScore?.status === "postponed"
                      ? "Game postponed"
                      : currentScore?.status === "canceled"
                        ? "Game canceled"
                        : cleanNflStatusDetail(currentScore?.status_detail) ||
                          (cloud.ownClaim
                            ? "Awaiting kickoff"
                            : "No team preview before confirmation")}
            </span>
          </div>
          <strong>
            {currentAssignment?.isBye
              ? "BYE"
              : currentScore?.status === "live" || currentScore?.status === "final"
                ? currentScore.score ?? "—"
                : "33"}
          </strong>
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
        <Stat
          label="Current pot"
          value={new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(scoring.currentPotCents / 100)}
          helper="Exact 33 wins"
        />
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

function CloudRules() {
  return (
    <div className="screen-stack">
      <section className="rules-hero">
        <div className="brand-mark">
              <OfficialLogo decorative />
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
  installPromptAvailable,
  isIos,
  isStandalone,
  onInstall,
  onNavigate,
  payments,
}: {
  auth: ReturnType<typeof useCloudAuth>;
  cloud: ReturnType<typeof useCloudEnrollment>;
  canOpenCommissioner: boolean;
  installPromptAvailable: boolean;
  isIos: boolean;
  isStandalone: boolean;
  onInstall: () => Promise<void>;
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
            {profileSubtitle(
              auth.profile?.role,
              cloud.ownClaim?.schedule_number,
            )}
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

      <section className="section-card production-app-card">
        <div className="section-heading">
          <h2>Install 33 Pool</h2>
          <p>GitHub Pages production PWA</p>
        </div>

        {isStandalone ? (
          <div className="production-ready-message">
            <strong>App installed</strong>
            <span>33 Pool is running in standalone app mode.</span>
          </div>
        ) : installPromptAvailable ? (
          <button
            className="production-install-button"
            onClick={() => void onInstall()}
            type="button"
          >
            Install on This Device
          </button>
        ) : isIos ? (
          <div className="production-install-help">
            <strong>Install on iPhone or iPad</strong>
            <span>Tap Share, then choose Add to Home Screen.</span>
          </div>
        ) : (
          <div className="production-install-help">
            <strong>Install from your browser menu</strong>
            <span>Open the browser menu and choose Install app or Add to Home Screen.</span>
          </div>
        )}

        <div className="production-url">
          <small>Production address</small>
          <strong>jidajanah-oss.github.io/33-Pool-Setup/</strong>
        </div>
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
