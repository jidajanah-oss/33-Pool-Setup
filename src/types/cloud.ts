import type { GeneratedScheduleAssignment, GeneratedScheduleSet } from "./pool";

export type CloudRole = "primary_commissioner" | "co_commissioner" | "player";

export interface CloudProfile {
  id: string;
  display_name: string;
  role: CloudRole;
  created_at: string;
  updated_at: string;
}

export interface CloudPoolStatus {
  id: number;
  pool_name: string;
  season: number;
  current_week: number;
  enrollment_open: boolean;
  schedule_locked: boolean;
  schedule_id: string | null;
  schedule_generated_at: string | null;
  schedule_locked_at: string | null;
}

export interface CloudNumberSlot {
  schedule_number: number;
  player_name: string | null;
  claimed: boolean;
  mine: boolean;
}

export interface CloudClaim {
  schedule_number: number;
  claimed_at: string;
}

export interface CloudWeeklyRow {
  schedule_number: number;
  player_name: string | null;
  team_code: string | null;
  team_name: string | null;
  is_bye: boolean | null;
  mine: boolean;
}

export interface CloudEnrollmentState {
  loading: boolean;
  error: string;
  poolStatus: CloudPoolStatus | null;
  commissionerExists: boolean;
  numberBoard: CloudNumberSlot[];
  ownClaim: CloudClaim | null;
  ownSchedule: GeneratedScheduleAssignment[];
  claimedCount: number;
  refresh: () => Promise<void>;
  claimNumber: (scheduleNumber: number) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  loadWeeklyBoard: (week: number) => Promise<CloudWeeklyRow[]>;
  bootstrapPrimaryCommissioner: () => Promise<void>;
  publishSchedule: (schedule: GeneratedScheduleSet) => Promise<void>;
  setEnrollmentOpen: (open: boolean) => Promise<void>;
  releaseNumber: (scheduleNumber: number) => Promise<void>;
}

export type CloudPaymentDirection = "credit" | "debit";

export type CloudPaymentMethod =
  | "cash"
  | "check"
  | "venmo"
  | "paypal"
  | "other";

export interface CloudPaymentAccount {
  uid: string;
  player_name: string;
  schedule_number: number | null;
  amount_paid_cents: number;
  season_amount_due_cents: number;
  winnings_earned_cents: number;
  winnings_paid_cents: number;
  updated_at: string;
  amount_due_through_current_week_cents: number;
  remaining_season_balance_cents: number;
  amount_behind_cents: number;
  payment_status: "current" | "behind";
}

export interface CloudPaymentTransaction {
  id: string;
  uid: string;
  player_name: string;
  schedule_number: number;
  amount_cents: number;
  direction: CloudPaymentDirection;
  method: CloudPaymentMethod;
  note: string;
  occurred_at: string;
  created_at: string;
  created_by_uid: string;
  created_by_name: string;
}

export interface CloudPaymentEntryInput {
  uid: string;
  player_name: string;
  schedule_number: number;
  amount_cents: number;
  direction: CloudPaymentDirection;
  method: CloudPaymentMethod;
  note: string;
  occurred_at: string;
}

export interface CloudPaymentState {
  loading: boolean;
  error: string;
  myAccount: CloudPaymentAccount | null;
  myTransactions: CloudPaymentTransaction[];
  commissionerAccounts: CloudPaymentAccount[];
  refresh: () => Promise<void>;
  loadTransactions: (uid: string) => Promise<CloudPaymentTransaction[]>;
  recordPayment: (input: CloudPaymentEntryInput) => Promise<void>;
}
