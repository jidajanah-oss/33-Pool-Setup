import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CloudEnrollmentState, CloudProfile, CloudWeeklyRow } from "../../types/cloud";
import type { GeneratedScheduleSet } from "../../types/pool";
import {
  bootstrapPrimaryCommissioner,
  claimCloudNumber,
  fetchCommissionerExists,
  fetchMyClaims,
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
  const [ownClaims, setOwnClaims] = useState<CloudEnrollmentState["ownClaims"]>([]);
  const selected = useRef<{ uid: string; entryId: string } | null>(null);
  const request = useRef(0);
  const invalidateRequests = useCallback(() => { ++request.current; }, []);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    if (!profile) {
      setLoading(false);
      setPoolStatus(null);
      setNumberBoard([]);
      setOwnClaim(null);
      setOwnSchedule([]);
      setOwnClaims([]);
      selected.current = null;
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [status, exists, board, claims] = await Promise.all([
        fetchPoolStatus(),
        fetchCommissionerExists(),
        fetchNumberBoard(),
        fetchMyClaims(),
      ]);
      const claim = claims.find((entry) => selected.current?.uid === profile.id
        && entry.entry_id === selected.current.entryId) ?? claims[0] ?? null;
      const schedule = claim ? await fetchMySchedule(claim.schedule_number) : [];
      if (version !== request.current) return;
      setPoolStatus(status);
      setCommissionerExists(exists);
      setNumberBoard(board);
      setOwnClaim(claim);
      setOwnClaims(claims);
      setOwnSchedule(schedule);
    } catch (caught) {
      if (version !== request.current) return;
      setOwnClaim(null);
      setOwnClaims([]);
      setOwnSchedule([]);
      setError(caught instanceof Error ? caught.message : "Cloud pool data could not be loaded.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void refresh();

    if (!profile) {
      return undefined;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    const timerId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, 10000);

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener(
      "visibilitychange",
      refreshWhenVisible,
    );

    return () => {
      invalidateRequests();
      window.clearInterval(timerId);
      window.removeEventListener(
        "focus",
        refreshWhenVisible,
      );
      window.removeEventListener(
        "pageshow",
        refreshWhenVisible,
      );
      document.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, [profile, refresh, invalidateRequests]);

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
    ownClaims,
    selectEntry: (entryId) => {
      if (!profile || !ownClaims.some((entry) => entry.entry_id === entryId)) return;
      selected.current = { uid: profile.id, entryId };
      setOwnClaim(null);
      setOwnSchedule([]);
      void refresh();
    },
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
