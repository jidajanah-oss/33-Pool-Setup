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

export type CloudGameStatus =
  | "not_started"
  | "live"
  | "final"
  | "postponed"
  | "canceled"
  | "bye";

export type CloudScoreSource = "manual" | "espn" | "unknown";

export interface CloudTeamScore {
  team_code: string;
  team_name: string;
  status: CloudGameStatus;
  score: number | null;
  source: CloudScoreSource;
  event_id: string | null;
  kickoff_at: string | null;
  status_detail: string;
  synced_at: string | null;
}

export interface CloudNflSyncSummary {
  provider: string;
  week: number;
  fetched_at: string;
  event_count: number;
  team_count: number;
  final_team_count: number;
  live_team_count: number;
  scheduled_team_count: number;
  exception_team_count: number;
}

export interface CloudScoringAssignment {
  schedule_number: number;
  uid: string | null;
  player_name: string | null;
  team_code: string;
  team_name: string;
  is_bye: boolean;
}

export type CloudResolutionType =
  | "carryover"
  | "exact_33"
  | "closest_33";

export type CloudPayoutStatus = "pending" | "on_hold" | "paid";

export interface CloudWinnerRecord {
  id: string;
  week: number;
  uid: string;
  player_name: string;
  schedule_number: number;
  team_code: string;
  team_name: string;
  final_score: number;
  distance_from_33: number;
  payout_cents: number;
  payout_status: CloudPayoutStatus;
  payment_eligible_at_finalization: boolean;
  finalized_at: string;
  paid_at: string | null;
}

export interface CloudWeeklyResult {
  week: number;
  weekly_addition_cents: number;
  carryover_in_cents: number;
  total_pot_cents: number;
  resolution_type: CloudResolutionType;
  qualifying_team_codes: string[];
  winner_count: number;
  total_payout_cents: number;
  carryover_out_cents: number;
  finalized_at: string;
  finalized_by_uid: string;
  finalized_by_name: string;
}

export interface CloudResolutionWinnerPreview {
  uid: string | null;
  player_name: string;
  schedule_number: number;
  team_code: string;
  team_name: string;
  final_score: number;
  distance_from_33: number;
  payout_cents: number;
}

export interface CloudResolutionPreview {
  week: number;
  complete_scores: boolean;
  claimed_count: number;
  all_players_claimed: boolean;
  weekly_addition_cents: number;
  carryover_in_cents: number;
  total_pot_cents: number;
  resolution_type: CloudResolutionType;
  qualifying_team_codes: string[];
  winners: CloudResolutionWinnerPreview[];
  carryover_out_cents: number;
  can_finalize: boolean;
  blocking_reasons: string[];
}

export interface CloudScoringWeekSnapshot {
  week: number;
  scores: CloudTeamScore[];
  result: CloudWeeklyResult | null;
  winners: CloudWinnerRecord[];
  assignments: CloudScoringAssignment[];
}

export interface CloudScoringState {
  loading: boolean;
  error: string;
  selectedWeek: number;
  currentWeek: number;
  scores: CloudTeamScore[];
  result: CloudWeeklyResult | null;
  winners: CloudWinnerRecord[];
  assignments: CloudScoringAssignment[];
  history: CloudWeeklyResult[];
  currentPotCents: number;
  providerSummary: CloudNflSyncSummary | null;
  providerLoading: boolean;
  providerError: string;
  setSelectedWeek: (week: number) => void;
  refresh: () => Promise<void>;
  refreshWeek: (week: number) => Promise<void>;
  saveScores: (week: number, scores: CloudTeamScore[]) => Promise<void>;
  syncFromProvider: (week: number) => Promise<CloudNflSyncSummary>;
  finalizeWeek: (week: number) => Promise<void>;
  reopenWeek: (week: number) => Promise<void>;
  markWinnerPaid: (winnerId: string) => Promise<void>;
}


export type CloudCommissionerSlotId = "backup1" | "backup2";

export interface CloudDirectoryUser {
  uid: string;
  display_name: string;
  email: string;
  role: CloudRole;
}

export interface CloudPoolInvite {
  id: string;
  display_name: string;
  email: string;
  status: "pending" | "signed_in";
  sent_at: string;
  sent_by_name: string;
  linked_uid: string | null;
}

export interface CloudCommissionerMember {
  uid: string;
  display_name: string;
  email: string;
  role: "primary_commissioner" | "co_commissioner";
  slot: "primary" | CloudCommissionerSlotId;
}

export interface CloudCommissionerTeamState {
  loading: boolean;
  error: string;
  users: CloudDirectoryUser[];
  invites: CloudPoolInvite[];
  primary: CloudCommissionerMember | null;
  backups: Record<
    CloudCommissionerSlotId,
    CloudCommissionerMember | null
  >;
  refresh: () => Promise<void>;
  sendInvite: (displayName: string, email: string) => Promise<void>;
  resendInvite: (inviteId: string) => Promise<void>;
  assignBackup: (
    slot: CloudCommissionerSlotId,
    uid: string,
  ) => Promise<void>;
  clearBackup: (slot: CloudCommissionerSlotId) => Promise<void>;
}
