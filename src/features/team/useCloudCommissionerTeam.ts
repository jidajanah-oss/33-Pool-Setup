import { useCallback, useEffect, useState } from "react";
import {
  assignCloudBackupCommissioner,
  clearCloudBackupCommissioner,
  createCloudPoolInvite,
  fetchCloudCommissionerTeam,
  resendCloudPoolInvite,
} from "../../services/cloudTeamService";
import type {
  CloudCommissionerSlotId,
  CloudCommissionerTeamState,
  CloudProfile,
} from "../../types/cloud";

const emptyBackups = {
  backup1: null,
  backup2: null,
} as const;

export function useCloudCommissionerTeam(
  profile: CloudProfile | null,
): CloudCommissionerTeamState {
  const canLoad =
    profile?.role === "primary_commissioner" ||
    profile?.role === "co_commissioner";
  const [loading, setLoading] = useState(canLoad);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<
    CloudCommissionerTeamState["users"]
  >([]);
  const [invites, setInvites] = useState<
    CloudCommissionerTeamState["invites"]
  >([]);
  const [primary, setPrimary] = useState<
    CloudCommissionerTeamState["primary"]
  >(null);
  const [backups, setBackups] = useState<
    CloudCommissionerTeamState["backups"]
  >({ ...emptyBackups });

  const refresh = useCallback(async () => {
    if (!canLoad) {
      setLoading(false);
      setError("");
      setUsers([]);
      setInvites([]);
      setPrimary(null);
      setBackups({ ...emptyBackups });
      return;
    }

    setLoading(true);
    setError("");

    try {
      const next = await fetchCloudCommissionerTeam();
      setUsers(next.users);
      setInvites(next.invites);
      setPrimary(next.primary);
      setBackups(next.backups);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The invitation and commissioner team could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [canLoad]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendInvite = async (
    displayName: string,
    email: string,
  ): Promise<void> => {
    await createCloudPoolInvite(displayName, email);
    await refresh();
  };

  const resendInvite = async (
    inviteId: string,
  ): Promise<void> => {
    await resendCloudPoolInvite(inviteId);
    await refresh();
  };

  const assignBackup = async (
    slot: CloudCommissionerSlotId,
    uid: string,
  ): Promise<void> => {
    await assignCloudBackupCommissioner(slot, uid);
    await refresh();
  };

  const clearBackup = async (
    slot: CloudCommissionerSlotId,
  ): Promise<void> => {
    await clearCloudBackupCommissioner(slot);
    await refresh();
  };

  return {
    loading,
    error,
    users,
    invites,
    primary,
    backups,
    refresh,
    sendInvite,
    resendInvite,
    assignBackup,
    clearBackup,
  };
}
