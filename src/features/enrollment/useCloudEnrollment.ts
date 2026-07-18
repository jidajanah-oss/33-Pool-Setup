import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudEnrollmentState, CloudProfile, CloudWeeklyRow } from "../../types/cloud";
import type { GeneratedScheduleSet } from "../../types/pool";
import {
  bootstrapPrimaryCommissioner,
  claimCloudNumber,
  fetchCommissionerExists,
  fetchMyClaim,
  fetchMySchedule,
  fetchNumberBoard,
  fetchPoolStatus,
  fetchWeeklyBoard,
  publishCloudSchedule,
  releaseCloudNumber,
  setCloudEnrollmentOpen,
  updateCloudDisplayName,
} from "../../services/cloudPoolService";

export function useCloudEnrollment(profile: CloudProfile | null): CloudEnrollmentState {
  const [loading, setLoading] = useState(Boolean(profile));
  const [error, setError] = useState("");
  const [poolStatus, setPoolStatus] = useState<CloudEnrollmentState["poolStatus"]>(null);
  const [commissionerExists, setCommissionerExists] = useState(false);
  const [numberBoard, setNumberBoard] = useState<CloudEnrollmentState["numberBoard"]>([]);
  const [ownClaim, setOwnClaim] = useState<CloudEnrollmentState["ownClaim"]>(null);
  const [ownSchedule, setOwnSchedule] = useState<CloudEnrollmentState["ownSchedule"]>([]);

  const refresh = useCallback(async () => {
    if (!profile) {
      setLoading(false);
      setPoolStatus(null);
      setNumberBoard([]);
      setOwnClaim(null);
      setOwnSchedule([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [status, exists, board, claim] = await Promise.all([
        fetchPoolStatus(),
        fetchCommissionerExists(),
        fetchNumberBoard(),
        fetchMyClaim(),
      ]);
      setPoolStatus(status);
      setCommissionerExists(exists);
      setNumberBoard(board);
      setOwnClaim(claim);
      setOwnSchedule(claim ? await fetchMySchedule(claim.schedule_number) : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cloud pool data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAndRefresh = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Cloud action failed.";
      setError(message);
      throw caught;
    }
  };

  return {
    loading,
    error,
    poolStatus,
    commissionerExists,
    numberBoard,
    ownClaim,
    ownSchedule,
    claimedCount: useMemo(() => numberBoard.filter((slot) => slot.claimed).length, [numberBoard]),
    refresh,
    claimNumber: (number) => runAndRefresh(() => claimCloudNumber(number)),
    updateDisplayName: (name) => runAndRefresh(() => updateCloudDisplayName(name)),
    loadWeeklyBoard: async (week: number): Promise<CloudWeeklyRow[]> => fetchWeeklyBoard(week),
    bootstrapPrimaryCommissioner: () => runAndRefresh(bootstrapPrimaryCommissioner),
    publishSchedule: (schedule: GeneratedScheduleSet) => runAndRefresh(() => publishCloudSchedule(schedule)),
    setEnrollmentOpen: (open: boolean) => runAndRefresh(() => setCloudEnrollmentOpen(open)),
    releaseNumber: (number: number) => runAndRefresh(() => releaseCloudNumber(number)),
  };
}
