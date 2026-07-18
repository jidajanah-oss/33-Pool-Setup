import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCloudScoringWeek,
  fetchCloudWeeklyResultHistory,
  fetchNflProviderPreview,
  finalizeCloudWeek,
  markCloudWinnerPaid,
  mergeCloudProviderScores,
  reopenCloudWeek,
  saveCloudTeamScores,
  syncCloudNflScores,
} from "../../services/cloudScoringService";
import type {
  CloudNflSyncSummary,
  CloudProfile,
  CloudScoringState,
  CloudTeamScore,
} from "../../types/cloud";

export function useCloudScoring(
  profile: CloudProfile | null,
  currentWeek: number,
  commissionerMode: boolean,
): CloudScoringState {
  const normalizedCurrentWeek = Math.min(18, Math.max(1, currentWeek));
  const [selectedWeek, setSelectedWeekState] = useState(normalizedCurrentWeek);
  const [loading, setLoading] = useState(Boolean(profile));
  const [error, setError] = useState("");
  const [scores, setScores] = useState<CloudTeamScore[]>([]);
  const [result, setResult] = useState<CloudScoringState["result"]>(null);
  const [winners, setWinners] = useState<CloudScoringState["winners"]>([]);
  const [assignments, setAssignments] = useState<CloudScoringState["assignments"]>([]);
  const [history, setHistory] = useState<CloudScoringState["history"]>([]);
  const [providerSummary, setProviderSummary] =
    useState<CloudNflSyncSummary | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerError, setProviderError] = useState("");

  const loadProviderPreview = useCallback(
    async (week: number, storedScores: readonly CloudTeamScore[]) => {
      setProviderLoading(true);
      setProviderError("");

      try {
        const provider = await fetchNflProviderPreview(week);
        setProviderSummary(provider.summary);
        setScores(mergeCloudProviderScores(storedScores, provider.scores));
      } catch (caught) {
        setProviderError(
          caught instanceof Error
            ? caught.message
            : "The live NFL scoreboard could not be loaded.",
        );
        setScores([...storedScores]);
      } finally {
        setProviderLoading(false);
      }
    },
    [],
  );

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

        if (!snapshot.result) {
          void loadProviderPreview(week, snapshot.scores);
        } else {
          setProviderSummary(null);
          setProviderError("");
        }
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
    [commissionerMode, loadProviderPreview, profile],
  );

  useEffect(() => {
    if (selectedWeek > normalizedCurrentWeek) {
      setSelectedWeekState(normalizedCurrentWeek);
      return;
    }

    void loadWeek(selectedWeek);
  }, [loadWeek, normalizedCurrentWeek, selectedWeek]);

  useEffect(() => {
    if (
      !profile ||
      result ||
      selectedWeek !== normalizedCurrentWeek
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadProviderPreview(selectedWeek, scores);
      }
    }, 120_000);

    return () => window.clearInterval(timer);
  }, [
    loadProviderPreview,
    normalizedCurrentWeek,
    profile,
    result,
    scores,
    selectedWeek,
  ]);

  const setSelectedWeek = (week: number) => {
    setSelectedWeekState(Math.min(18, Math.max(1, Math.round(week))));
  };

  const refresh = async () => loadWeek(selectedWeek);

  const refreshWeek = async (week: number) => {
    setSelectedWeekState(week);
    await loadWeek(week);
  };

  const saveScores = async (week: number, nextScores: CloudTeamScore[]) => {
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

  const syncFromProvider = async (week: number) => {
    setProviderLoading(true);
    setProviderError("");
    try {
      const summary = await syncCloudNflScores(week);
      setProviderSummary(summary);
      await loadWeek(week);
      return summary;
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The NFL scoreboard sync failed.";
      setProviderError(message);
      throw caught;
    } finally {
      setProviderLoading(false);
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
        caught instanceof Error ? caught.message : "The week could not be finalized.";
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
        caught instanceof Error ? caught.message : "The week could not be reopened.";
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
        caught instanceof Error ? caught.message : "The payout could not be marked paid.";
      setError(message);
      throw caught;
    }
  };

  const currentPotCents = useMemo(() => {
    const previous =
      history.find((weeklyResult) => weeklyResult.week === normalizedCurrentWeek - 1)
        ?.carryover_out_cents ?? 0;
    const currentResult = history.find(
      (weeklyResult) => weeklyResult.week === normalizedCurrentWeek,
    );

    if (currentResult && normalizedCurrentWeek === 18) {
      return currentResult.carryover_out_cents;
    }

    return currentResult ? currentResult.total_pot_cents : previous + 9_600;
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
    providerSummary,
    providerLoading,
    providerError,
    setSelectedWeek,
    refresh,
    refreshWeek,
    saveScores,
    syncFromProvider,
    finalizeWeek,
    reopenWeek,
    markWinnerPaid,
  };
}
