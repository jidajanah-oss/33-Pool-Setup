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
