import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  mySchedule,
  numberSlots,
  paymentRecord,
  POOL_CONSTANTS,
  potWeeks,
  rules,
  weeklyAssignments,
} from "./data/demoData";
import { PlayerClaimManager } from "./features/commissioner/PlayerClaimManager";
import { ScheduleGeneratorPanel } from "./features/commissioner/ScheduleGeneratorPanel";
import { EnrollmentMySchedule, EnrollmentNumberBoard, EnrollmentWeeklyBoard } from "./features/enrollment/EnrollmentScreens";
import { useLocalEnrollment } from "./features/enrollment/useLocalEnrollment";
import type { AppScreen, ViewMode } from "./types/pool";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

const desktopNavigation: Array<{ id: AppScreen; label: string }> = [
  { id: "home", label: "Home" },
  { id: "numbers", label: "Choose Number" },
  { id: "schedule", label: "My Schedule" },
  { id: "weekly", label: "Weekly Board" },
  { id: "pot", label: "Pot Tracker" },
  { id: "payments", label: "Payments" },
  { id: "rules", label: "Rules" },
  { id: "commissioner", label: "Commissioner" },
];

const mobileNavigation: Array<{
  id: AppScreen;
  label: string;
  icon: "home" | "calendar" | "week" | "pot" | "more";
}> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "schedule", label: "My Line", icon: "calendar" },
  { id: "weekly", label: "Week", icon: "week" },
  { id: "pot", label: "Pot", icon: "pot" },
  { id: "more", label: "More", icon: "more" },
];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function App() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [viewMode, setViewMode] = useState<ViewMode>("player");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const enrollment = useLocalEnrollment();

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

    setIsStandalone(standalone);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  const claimedCount = enrollment.claims.length;
  const availableCount = POOL_CONSTANTS.playerCount - claimedCount;
  const currentPot =
    potWeeks.find((week) => week.status === "current")?.availablePot ?? 0;

  const moreScreens: AppScreen[] = [
    "numbers",
    "payments",
    "rules",
    "commissioner",
    "more",
  ];

  const activeMobileScreen = moreScreens.includes(screen) ? "more" : screen;

  const currentTitle = useMemo(() => {
    const titles: Record<AppScreen, string> = {
      home: "33 Pool",
      numbers: "Choose Number",
      schedule: "My Line",
      weekly: "Weekly Board",
      pot: "Pot Tracker",
      payments: "Payments",
      rules: "Rules",
      commissioner: "Commissioner",
      more: "More",
    };
    return titles[screen];
  }, [screen]);

  const switchMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "player" && screen === "commissioner") {
      setScreen("more");
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <Brand />
        <nav>
          {desktopNavigation
            .filter(
              (item) =>
                item.id !== "commissioner" || viewMode === "commissioner",
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
          <small>2026 Enrollment</small>
          <strong>{claimedCount} of 32 claimed</strong>
          <div className="progress-track">
            <span
              style={{
                width: `${(claimedCount / POOL_CONSTANTS.playerCount) * 100}%`,
              }}
            />
          </div>
        </div>
      </aside>

      <div className="app-stage">
        <header className="mobile-header">
          <button
            aria-label="Open more options"
            className="brand-button"
            onClick={() => setScreen("more")}
            type="button"
          >
            <BrandMark />
          </button>
          <div>
            <small>33 Pool Setup</small>
            <strong>{currentTitle}</strong>
          </div>
          <div className="header-number">{enrollment.ownClaim ? `#${enrollment.ownClaim.scheduleNumber}` : "Open"}</div>
        </header>

        <header className="desktop-header">
          <div>
            <p className="eyebrow">{currentTitle}</p>
            <h1>33 Pool Setup</h1>
          </div>
          <div className="desktop-actions">
            <ModeSwitch viewMode={viewMode} onChange={switchMode} />
            <div className="profile-chip">
              <span>{(enrollment.profile?.name ?? "P").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{enrollment.profile?.name ?? "Player Setup"}</strong>
                <small>{enrollment.ownClaim ? `Schedule #${enrollment.ownClaim.scheduleNumber}` : "No number chosen"}</small>
              </div>
            </div>
          </div>
        </header>

        <main className="app-content">
          {screen === "home" && (
            <HomeScreen
              availableCount={availableCount}
              claimedCount={claimedCount}
              currentPot={currentPot}
              installPromptAvailable={Boolean(installPrompt)}
              isStandalone={isStandalone}
              onInstall={handleInstall}
              onNavigate={setScreen}
            />
          )}
          {screen === "numbers" && <EnrollmentNumberBoard enrollment={enrollment} />}
          {screen === "schedule" && <EnrollmentMySchedule enrollment={enrollment} />}
          {screen === "weekly" && <EnrollmentWeeklyBoard enrollment={enrollment} viewMode={viewMode} />}
          {screen === "pot" && <PotTrackerScreen />}
          {screen === "payments" && <PaymentsScreen />}
          {screen === "rules" && <RulesScreen />}
          {screen === "commissioner" && viewMode === "commissioner" && (
            <CommissionerScreen
              availableCount={availableCount}
              claimedCount={claimedCount}
              enrollment={enrollment}
            />
          )}
          {screen === "more" && (
            <MoreScreen
              viewMode={viewMode}
              onModeChange={switchMode}
              onNavigate={setScreen}
            />
          )}
        </main>

        <nav className="phone-tab-bar" aria-label="Phone navigation">
          {mobileNavigation.map((item) => (
            <button
              className={activeMobileScreen === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setScreen(item.id)}
              type="button"
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="desktop-brand">
      <BrandMark />
      <div>
        <strong>33 Pool</strong>
        <small>Season Tracker</small>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span>33</span>
    </div>
  );
}

function ModeSwitch({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="mode-switch">
      <button
        className={viewMode === "player" ? "selected" : ""}
        onClick={() => onChange("player")}
        type="button"
      >
        Player
      </button>
      <button
        className={viewMode === "commissioner" ? "selected" : ""}
        onClick={() => onChange("commissioner")}
        type="button"
      >
        Commissioner
      </button>
    </div>
  );
}

function NavIcon({
  name,
}: {
  name: "home" | "calendar" | "week" | "pot" | "more";
}) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.7 12 3l9 7.7v9.1a1.2 1.2 0 0 1-1.2 1.2h-5.1v-6.2H9.3V21H4.2A1.2 1.2 0 0 1 3 19.8z" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 10h18M8 14h3M13 14h3M8 17h3" />
      </svg>
    );
  }

  if (name === "week") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v14H4zM8 9h8M8 13h5M8 17h8" />
      </svg>
    );
  }

  if (name === "pot") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10l2 4-2.2 8H7.2L5 11zM9 7V4h6v3M8 12h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

interface HomeScreenProps {
  claimedCount: number;
  availableCount: number;
  currentPot: number;
  installPromptAvailable: boolean;
  isStandalone: boolean;
  onInstall: () => Promise<void>;
  onNavigate: (screen: AppScreen) => void;
}

function HomeScreen({
  claimedCount,
  availableCount,
  currentPot,
  installPromptAvailable,
  isStandalone,
  onInstall,
  onNavigate,
}: HomeScreenProps) {
  return (
    <div className="screen-stack">
      <section className="score-hero">
        <div className="hero-topline">
          <span>Week 2</span>
          <span className="live-dot">Live demo</span>
        </div>
        <p>Your team this week</p>
        <div className="hero-team">
          <div className="team-roundel">SEA</div>
          <div>
            <h2>Seattle</h2>
            <span>Current score</span>
          </div>
          <strong>17</strong>
        </div>
        <div className="target-row">
          <span>Final score needed to win</span>
          <strong>33</strong>
        </div>
      </section>

      <section className="pot-card">
        <div>
          <small>Current accumulated pot</small>
          <strong>{money.format(currentPot)}</strong>
          <span>$96 added for Week 2</span>
        </div>
        <button onClick={() => onNavigate("pot")} type="button">
          View pot
        </button>
      </section>

      <section className="mobile-stat-grid">
        <StatCard label="Your number" value="#17" helper="Locked" />
        <StatCard
          label="Enrollment"
          value={`${claimedCount}/32`}
          helper={`${availableCount} open`}
        />
        <StatCard label="Payment" value="Current" helper="$18 paid" />
        <StatCard label="Season wins" value="0" helper="$0 earned" />
      </section>

      {!isStandalone && (
        <section className="install-card">
          <div className="install-icon">
            <BrandMark />
          </div>
          <div>
            <strong>Install 33 Pool</strong>
            <p>
              Add the tracker to your phone Home Screen for a full-screen app
              experience.
            </p>
          </div>
          <button
            disabled={!installPromptAvailable}
            onClick={() => void onInstall()}
            type="button"
          >
            {installPromptAvailable ? "Install" : "Ready after deployment"}
          </button>
        </section>
      )}

      <section className="section-card">
        <SectionHeading
          title="Quick access"
          subtitle="Everything you need this week"
        />
        <div className="quick-grid">
          <QuickButton
            label="My full line"
            helper="18 weekly teams"
            onClick={() => onNavigate("schedule")}
            symbol="18"
          />
          <QuickButton
            label="Weekly board"
            helper="All 32 assignments"
            onClick={() => onNavigate("weekly")}
            symbol="32"
          />
          <QuickButton
            label="Payments"
            helper="Current through Week 2"
            onClick={() => onNavigate("payments")}
            symbol="$"
          />
          <QuickButton
            label="Rules"
            helper="Exact 33 wins"
            onClick={() => onNavigate("rules")}
            symbol="33"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
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

function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function QuickButton({
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
    <button className="quick-button" onClick={onClick} type="button">
      <span>{symbol}</span>
      <strong>{label}</strong>
      <small>{helper}</small>
    </button>
  );
}

function NumberBoardScreen() {
  return (
    <div className="screen-stack">
      <section className="screen-intro">
        <p className="eyebrow">Blind selection</p>
        <h2>Choose an available number</h2>
        <p>
          Teams and bye weeks remain hidden until a player confirms a numbered
          schedule line.
        </p>
      </section>

      <section className="selection-summary">
        <div>
          <span className="availability-dot available" />
          <strong>Available</strong>
        </div>
        <div>
          <span className="availability-dot claimed" />
          <strong>Claimed</strong>
        </div>
        <div>
          <span className="availability-dot mine" />
          <strong>Your #17</strong>
        </div>
      </section>

      <section className="number-grid">
        {numberSlots.map((slot) => (
          <button
            aria-label={`Schedule number ${slot.number}, ${slot.status}`}
            className={`number-card ${slot.status}`}
            disabled={slot.status !== "available"}
            key={slot.number}
            type="button"
          >
            <strong>{slot.number}</strong>
            <span>
              {slot.status === "available"
                ? "Open"
                : slot.status === "mine"
                  ? "Yours"
                  : "Taken"}
            </span>
          </button>
        ))}
      </section>

      <section className="info-banner">
        Demo Player already owns Schedule #17. Live claims will be added after
        cloud authentication.
      </section>
    </div>
  );
}

function MyScheduleScreen() {
  return (
    <div className="screen-stack">
      <section className="line-summary-card">
        <div>
          <p>Schedule line</p>
          <strong>#17</strong>
        </div>
        <div>
          <p>Playing weeks</p>
          <strong>17</strong>
        </div>
        <div>
          <p>Bye weeks</p>
          <strong>1</strong>
        </div>
      </section>

      <section className="screen-intro compact">
        <p className="eyebrow">Full season</p>
        <h2>Your weekly teams</h2>
        <p>Demo teams only. The official generator comes next.</p>
      </section>

      <section className="schedule-list">
        {mySchedule.map((week) => (
          <article
            className={`schedule-card ${week.status === "bye" ? "bye" : ""}`}
            key={week.week}
          >
            <div className="week-box">
              <small>WK</small>
              <strong>{week.week}</strong>
            </div>
            <div className="team-code-box">{week.teamCode}</div>
            <div className="schedule-team-copy">
              <strong>{week.team}</strong>
              <span>{statusLabel(week.status, week.score)}</span>
            </div>
            <div className="schedule-result">
              {week.status === "bye" ? (
                <span className="pill bye">BYE</span>
              ) : week.score !== undefined ? (
                <strong>{week.score}</strong>
              ) : (
                <span>—</span>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function statusLabel(
  status: "upcoming" | "live" | "final" | "bye",
  score?: number,
) {
  if (status === "bye") {
    return "Your pool bye";
  }
  if (status === "live") {
    return `Live · ${score ?? 0} points`;
  }
  if (status === "final") {
    return `Final · ${score ?? 0} points`;
  }
  return "Upcoming";
}

function WeeklyBoardScreen() {
  const [filter, setFilter] = useState<
    "all" | "live" | "final" | "not-started"
  >("all");

  const filteredAssignments =
    filter === "all"
      ? weeklyAssignments
      : weeklyAssignments.filter((assignment) => assignment.status === filter);

  return (
    <div className="screen-stack">
      <section className="week-banner">
        <div>
          <small>Current board</small>
          <strong>Week 1</strong>
          <span>Final score of 33 wins</span>
        </div>
        <div>
          <small>Pot</small>
          <strong>$96</strong>
        </div>
      </section>

      <section className="filter-row" aria-label="Weekly board filters">
        {(["all", "live", "final", "not-started"] as const).map((item) => (
          <button
            className={filter === item ? "active" : ""}
            key={item}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item === "all"
              ? "All"
              : item === "not-started"
                ? "Upcoming"
                : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </section>

      <section className="assignment-list">
        {filteredAssignments.map((assignment) => (
          <article
            className={`assignment-row ${
              assignment.number === 17 ? "mine" : ""
            }`}
            key={assignment.number}
          >
            <div className="assignment-number">#{assignment.number}</div>
            <div className="team-code-box small">{assignment.teamCode}</div>
            <div className="assignment-copy">
              <strong>{assignment.playerName}</strong>
              <span>{assignment.team}</span>
            </div>
            <div className="assignment-score">
              {assignment.status === "bye" ? (
                <span className="pill bye">BYE</span>
              ) : assignment.score !== undefined ? (
                <>
                  <strong>{assignment.score}</strong>
                  <small>
                    {assignment.status === "live" ? "LIVE" : "FINAL"}
                  </small>
                </>
              ) : (
                <span>—</span>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function PotTrackerScreen() {
  return (
    <div className="screen-stack">
      <section className="pot-hero">
        <p>Current accumulated pot</p>
        <strong>$192</strong>
        <span>Week 2 · No exact 33 yet</span>
      </section>

      <section className="mobile-stat-grid">
        <StatCard label="Weekly addition" value="$96" helper="32 × $3" />
        <StatCard label="Season money" value="$1,728" helper="Maximum total" />
        <StatCard label="Awarded" value="$0" helper="Demo season" />
        <StatCard label="Carryover" value="$192" helper="Into current week" />
      </section>

      <section className="section-card">
        <SectionHeading
          title="Weekly pot history"
          subtitle="Carryover, winners, and payouts"
        />
        <div className="pot-timeline">
          {potWeeks.map((week) => (
            <article className={`pot-week ${week.status}`} key={week.week}>
              <div className="timeline-week">
                <span>{week.week}</span>
              </div>
              <div className="pot-week-copy">
                <strong>Week {week.week}</strong>
                <span>
                  {week.winnerNames.length > 0
                    ? week.winnerNames.join(", ")
                    : week.status === "upcoming"
                      ? "Upcoming"
                      : "No team finished with 33"}
                </span>
              </div>
              <div className="pot-week-money">
                <strong>{money.format(week.availablePot)}</strong>
                <small>
                  {week.status === "final"
                    ? `${money.format(week.carryoverOut)} carried`
                    : week.status === "current"
                      ? "Current pot"
                      : "Projected"}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PaymentsScreen() {
  const current =
    paymentRecord.amountPaid >= paymentRecord.amountDueThroughCurrentWeek;
  const percent =
    (paymentRecord.amountPaid / paymentRecord.seasonAmountDue) * 100;

  return (
    <div className="screen-stack">
      <section className={`payment-status-card ${current ? "current" : "late"}`}>
        <small>Payment eligibility</small>
        <strong>{current ? "Current" : "Behind"}</strong>
        <span>
          {current
            ? "Eligible to receive a prize through Week 2"
            : "Bring account current before prize payment"}
        </span>
      </section>

      <section className="section-card">
        <SectionHeading
          title="Season payments"
          subtitle="Demo Player · Schedule #17"
        />
        <div className="money-pair">
          <div>
            <small>Paid</small>
            <strong>{money.format(paymentRecord.amountPaid)}</strong>
          </div>
          <div>
            <small>Season total</small>
            <strong>{money.format(paymentRecord.seasonAmountDue)}</strong>
          </div>
        </div>
        <div className="large-progress">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="detail-list">
          <div>
            <span>Due through current week</span>
            <strong>
              {money.format(paymentRecord.amountDueThroughCurrentWeek)}
            </strong>
          </div>
          <div>
            <span>Remaining season balance</span>
            <strong>
              {money.format(
                paymentRecord.seasonAmountDue - paymentRecord.amountPaid,
              )}
            </strong>
          </div>
        </div>
      </section>

      <section className="section-card">
        <SectionHeading title="Winnings" subtitle="Calculated and paid prizes" />
        <div className="money-pair">
          <div>
            <small>Earned</small>
            <strong>{money.format(paymentRecord.winningsEarned)}</strong>
          </div>
          <div>
            <small>Paid</small>
            <strong>{money.format(paymentRecord.winningsPaid)}</strong>
          </div>
        </div>
        <div className="empty-copy">
          Exact-33 winnings appear after commissioner finalization.
        </div>
      </section>

      <section className="section-card">
        <SectionHeading title="Payment history" subtitle="Demo transaction" />
        <article className="transaction-card">
          <div>
            <strong>Season payment</strong>
            <span>Cash · Before Week 1</span>
          </div>
          <strong>$18</strong>
        </article>
      </section>
    </div>
  );
}

function RulesScreen() {
  return (
    <div className="screen-stack">
      <section className="rules-hero">
        <BrandMark />
        <div>
          <small>Official pool rules</small>
          <strong>Final score of 33 wins</strong>
          <span>32 players · $3 per week · 18 paid weeks</span>
        </div>
      </section>

      <section className="mobile-stat-grid">
        <StatCard label="Players" value="32" helper="One line each" />
        <StatCard label="Season cost" value="$54" helper="$3 × 18" />
        <StatCard label="Playing weeks" value="17" helper="Plus one bye" />
        <StatCard label="Weekly pot" value="$96" helper="Carries over" />
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

function CommissionerScreen({
  claimedCount,
  availableCount,
  enrollment,
}: {
  claimedCount: number;
  availableCount: number;
  enrollment: ReturnType<typeof useLocalEnrollment>;
}) {
  return (
    <div className="screen-stack">
      <section className="commissioner-hero">
        <small>Commissioner Control Center</small>
        <strong>Setup phase</strong>
        <span>Generate, validate, preview, export, and lock the 32 anonymous schedule lines.</span>
      </section>

      <section className="mobile-stat-grid">
        <StatCard
          label="Claimed"
          value={`${claimedCount}/32`}
          helper={`${availableCount} open`}
        />
        <StatCard label="Schedules" value="Ready" helper="Local generator installed" />
        <StatCard label="Collected" value="$18" helper="Demo only" />
        <StatCard label="Current pot" value="$192" helper="Demo Week 2" />
      </section>

      <section className="section-card">
        <SectionHeading
          title="Season setup"
          subtitle="Required before number selection opens"
        />
        <div className="check-list">
          <CheckItem label="Official rules approved" complete />
          <CheckItem label="Standalone repository ready" complete />
          <CheckItem label="Phone-first PWA foundation" complete />
          <CheckItem label="Official 2026 NFL bye weeks loaded" complete />
          <CheckItem label="Anonymous schedule generator installed" complete />
          <CheckItem label="Generate and lock official lines" />
        </div>
      </section>

      <ScheduleGeneratorPanel />
      <PlayerClaimManager enrollment={enrollment} />
    </div>
  );
}

function CheckItem({
  label,
  complete = false,
}: {
  label: string;
  complete?: boolean;
}) {
  return (
    <div className="check-item">
      <span className={complete ? "complete" : ""}>
        {complete ? "✓" : ""}
      </span>
      <strong>{label}</strong>
      <small>{complete ? "Complete" : "Pending"}</small>
    </div>
  );
}

function MoreScreen({
  viewMode,
  onModeChange,
  onNavigate,
}: {
  viewMode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onNavigate: (screen: AppScreen) => void;
}) {
  return (
    <div className="screen-stack">
      <section className="profile-panel">
        <div className="profile-avatar">DP</div>
        <div>
          <strong>Demo Player</strong>
          <span>Schedule #17 · Payment current</span>
        </div>
      </section>

      <section className="more-grid">
        <MoreButton
          label="Choose Number"
          helper="View number availability"
          onClick={() => onNavigate("numbers")}
          symbol="#"
        />
        <MoreButton
          label="Payments"
          helper="Balance and prize status"
          onClick={() => onNavigate("payments")}
          symbol="$"
        />
        <MoreButton
          label="Pool Rules"
          helper="Approved official rules"
          onClick={() => onNavigate("rules")}
          symbol="33"
        />
        {viewMode === "commissioner" && (
          <MoreButton
            label="Commissioner"
            helper="Setup and season controls"
            onClick={() => onNavigate("commissioner")}
            symbol="C"
          />
        )}
      </section>

      <section className="section-card">
        <SectionHeading title="Preview role" subtitle="Local foundation only" />
        <ModeSwitch viewMode={viewMode} onChange={onModeChange} />
      </section>

      <section className="about-card">
        <BrandMark />
        <div>
          <strong>33 Pool Setup</strong>
          <span>Mobile PWA foundation · Package 2</span>
        </div>
      </section>
    </div>
  );
}

function MoreButton({
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
    <button className="more-button" onClick={onClick} type="button">
      <span>{symbol}</span>
      <div>
        <strong>{label}</strong>
        <small>{helper}</small>
      </div>
      <b>›</b>
    </button>
  );
}

export default App;
