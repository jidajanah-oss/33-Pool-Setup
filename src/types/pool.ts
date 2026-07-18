export type AppScreen =
  | "home"
  | "numbers"
  | "schedule"
  | "weekly"
  | "pot"
  | "payments"
  | "rules"
  | "commissioner"
  | "more";

export type ViewMode = "player" | "commissioner";

export interface NumberSlot {
  number: number;
  status: "available" | "claimed" | "mine";
  playerName?: string;
}

export interface ScheduleWeek {
  week: number;
  team: string;
  teamCode: string;
  status: "upcoming" | "live" | "final" | "bye";
  score?: number;
  result?: "winner" | "no-33";
  payout?: number;
}

export interface WeeklyAssignment {
  number: number;
  playerName: string;
  team: string;
  teamCode: string;
  status: "not-started" | "live" | "final" | "bye";
  score?: number;
  isWinner?: boolean;
}

export interface PotWeek {
  week: number;
  weeklyAddition: number;
  carryoverIn: number;
  availablePot: number;
  winnerNames: string[];
  payout: number;
  carryoverOut: number;
  status: "final" | "current" | "upcoming";
}

export interface PaymentRecord {
  playerName: string;
  scheduleNumber: number;
  amountPaid: number;
  amountDueThroughCurrentWeek: number;
  seasonAmountDue: number;
  winningsEarned: number;
  winningsPaid: number;
}

export interface NflTeam {
  code: string;
  name: string;
  byeWeek: number;
}

export interface GeneratedScheduleAssignment {
  week: number;
  teamCode: string;
  teamName: string;
  isBye: boolean;
}

export interface GeneratedScheduleLine {
  lineNumber: number;
  assignments: GeneratedScheduleAssignment[];
}

export interface ScheduleValidationSummary {
  isValid: boolean;
  errors: string[];
  lineCount: number;
  weekCount: number;
  assignmentCount: number;
  byeAssignmentCount: number;
}

export interface GeneratedScheduleSet {
  version: 1;
  season: 2026;
  id: string;
  seed: string;
  generatedAt: string;
  lockedAt: string | null;
  lines: GeneratedScheduleLine[];
  validation: ScheduleValidationSummary;
}

export interface LocalPlayerProfile {
  id: string;
  name: string;
  createdAt: string;
}

export interface PlayerClaim {
  playerId: string;
  playerName: string;
  scheduleNumber: number;
  claimedAt: string;
}
