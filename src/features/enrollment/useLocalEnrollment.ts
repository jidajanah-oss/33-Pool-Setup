import { useCallback, useEffect, useMemo, useState } from "react";
import {
  claimScheduleNumber,
  clearLocalClaims,
  ENROLLMENT_UPDATED_EVENT,
  readClaims,
  readLocalPlayer,
  readScheduleSet,
  releaseScheduleNumber,
  saveLocalPlayerName,
} from "../../services/enrollmentService";
import type { GeneratedScheduleSet, LocalPlayerProfile, PlayerClaim } from "../../types/pool";

export interface LocalEnrollmentController {
  schedule: GeneratedScheduleSet | null;
  claims: PlayerClaim[];
  profile: LocalPlayerProfile | null;
  ownClaim: PlayerClaim | null;
  saveName: (name: string) => void;
  claimNumber: (number: number) => void;
  releaseNumber: (number: number) => void;
  clearClaims: () => void;
  refresh: () => void;
}

export function useLocalEnrollment(): LocalEnrollmentController {
  const [schedule, setSchedule] = useState(() => readScheduleSet());
  const [claims, setClaims] = useState(() => readClaims());
  const [profile, setProfile] = useState(() => readLocalPlayer());

  const refresh = useCallback(() => {
    setSchedule(readScheduleSet());
    setClaims(readClaims());
    setProfile(readLocalPlayer());
  }, []);

  useEffect(() => {
    window.addEventListener(ENROLLMENT_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ENROLLMENT_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const ownClaim = useMemo(
    () => profile ? claims.find((claim) => claim.playerId === profile.id) ?? null : null,
    [claims, profile],
  );

  return {
    schedule,
    claims,
    profile,
    ownClaim,
    saveName: (name) => { saveLocalPlayerName(name); refresh(); },
    claimNumber: (number) => {
      const currentProfile = readLocalPlayer();
      if (!currentProfile) throw new Error("Enter the player's name first.");
      claimScheduleNumber(currentProfile, number);
      refresh();
    },
    releaseNumber: (number) => { releaseScheduleNumber(number); refresh(); },
    clearClaims: () => { clearLocalClaims(); refresh(); },
    refresh,
  };
}
