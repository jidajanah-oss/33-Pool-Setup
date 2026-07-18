import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCloudScoringWeek,
  fetchCloudWeeklyResultHistory,
  finalizeCloudWeek,
  markCloudWinnerPaid,
  reopenCloudWeek,
  saveCloudTeamScores,
} from "../../services/cloudScoringService";
import type {
  CloudProfile,
  CloudScoringState,
  CloudTeamScore,
} from "../../types/cloud";

export function useCloudScoring(
  profile: CloudProfile | null,
  currentWeek: number,
  commissionerMode: boolean,
): CloudScoringState {
  const normalizedCurrentWeek = Math.min(
    18,
    Math.max(1, currentWeek),
  );
  const [selectedWeek, setSelectedWeekState] = useState(
    normalizedCurrentWeek,
  );
  const [loading, setLoading] = useState(Boolean(profile));
  const [error, setError] = useState("");
  const [scores, setScores] = useState<CloudTeamScore[]>([]);
  const [result, setResult] =
    useState<CloudScoringState["result"]>(null);
  const [winners, setWinners] = useState<
    CloudScoringState["winners"]
  >([]);
  const [assignments, setAssignments] = useState<
    CloudScoringState["assignments"]
  >([]);
  const [history, setHistory] = useState<
    CloudScoringState["history"]
  >([]);

  const loadWeek = useCallback(
    async (week: number) => {
      if (!profile) {
        setLoading(false);
        setScores([]);
        setResult(null);
        setWinners([]);
        setAssignments([]);
        setHistory([]);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [snapshot, nextHistory] = await Promise.all([
          fetchCloudScoringWeek(week, commissionerMode),
          fetchCloudWeeklyResultHistory(),
        ]);

        setScores(snapshot.scores);
        setResult(snapshot.result);
        setWinners(snapshot.winners);
        setAssignments(snapshot.assignments);
        setHistory(nextHistory);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "The Firebase scoring data could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [commissionerMode, profile],
  );

  useEffect(() => {
    if (selectedWeek > normalizedCurrentWeek) {
      setSelectedWeekState(normalizedCurrentWeek);
      return;
    }

    void loadWeek(selectedWeek);
  }, [loadWeek, normalizedCurrentWeek, selectedWeek]);

  const setSelectedWeek = (week: number) => {
    const normalized = Math.min(18, Math.max(1, Math.round(week)));
    setSelectedWeekState(normalized);
  };

  const refresh = async () => {
    await loadWeek(selectedWeek);
  };

  const refreshWeek = async (week: number) => {
    setSelectedWeekState(week);
    await loadWeek(week);
  };

  const saveScores = async (
    week: number,
    nextScores: CloudTeamScore[],
  ) => {
    setError("");

    try {
      await saveCloudTeamScores(week, nextScores);
      await loadWeek(week);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The team scores could not be saved.";
      setError(message);
      throw caught;
    }
  };

  const finalizeWeek = async (week: number) => {
    setError("");

    try {
      await finalizeCloudWeek(week);
      const nextWeek = week < 18 ? week + 1 : 18;
      setSelectedWeekState(nextWeek);
      await loadWeek(nextWeek);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The week could not be finalized.";
      setError(message);
      throw caught;
    }
  };

  const reopenWeek = async (week: number) => {
    setError("");

    try {
      await reopenCloudWeek(week);
      setSelectedWeekState(week);
      await loadWeek(week);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The week could not be reopened.";
      setError(message);
      throw caught;
    }
  };

  const markWinnerPaid = async (winnerId: string) => {
    setError("");

    try {
      await markCloudWinnerPaid(winnerId);
      await loadWeek(selectedWeek);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The payout could not be marked paid.";
      setError(message);
      throw caught;
    }
  };

  const currentPotCents = useMemo(() => {
    const previous =
      history.find(
        (weeklyResult) =>
          weeklyResult.week === normalizedCurrentWeek - 1,
      )?.carryover_out_cents ?? 0;
    const currentResult = history.find(
      (weeklyResult) =>
        weeklyResult.week === normalizedCurrentWeek,
    );

    if (currentResult && normalizedCurrentWeek === 18) {
      return currentResult.carryover_out_cents;
    }

    return currentResult
      ? currentResult.total_pot_cents
      : previous + 9_600;
  }, [history, normalizedCurrentWeek]);

  return {
    loading,
    error,
    selectedWeek,
    currentWeek: normalizedCurrentWeek,
    scores,
    result,
    winners,
    assignments,
    history,
    currentPotCents,
    setSelectedWeek,
    refresh,
    refreshWeek,
    saveScores,
    finalizeWeek,
    reopenWeek,
    markWinnerPaid,
  };
}
