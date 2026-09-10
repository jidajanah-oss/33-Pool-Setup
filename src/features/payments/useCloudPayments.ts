import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCommissionerPaymentAccounts,
  fetchMyPaymentAccount,
  fetchPaymentTransactionsForUid,
  recordCloudPaymentTransaction,
} from "../../services/cloudPaymentService";
import type {
  CloudPaymentEntryInput,
  CloudPaymentState,
  CloudProfile,
} from "../../types/cloud";

export function useCloudPayments(
  profile: CloudProfile | null,
  currentWeek: number,
  commissionerMode: boolean,
  entryId?: string,
): CloudPaymentState {
  const [loading, setLoading] = useState(Boolean(profile));
  const [error, setError] = useState("");
  const request = useRef(0);
  const invalidateRequests = useCallback(() => { ++request.current; }, []);
  const [myAccount, setMyAccount] =
    useState<CloudPaymentState["myAccount"]>(null);
  const [myTransactions, setMyTransactions] = useState<
    CloudPaymentState["myTransactions"]
  >([]);
  const [commissionerAccounts, setCommissionerAccounts] = useState<
    CloudPaymentState["commissionerAccounts"]
  >([]);

  const refresh = useCallback(async () => {
    const version = ++request.current;
    setMyAccount(null);
    setMyTransactions([]);
    if (!profile) {
      setLoading(false);
      setError("");
      setMyAccount(null);
      setMyTransactions([]);
      setCommissionerAccounts([]);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const account = entryId ? await fetchMyPaymentAccount(currentWeek, entryId) : null;
      const [transactions, accounts] = await Promise.all([
        account ? fetchPaymentTransactionsForUid(account.uid) : Promise.resolve([]),
        commissionerMode
          ? fetchCommissionerPaymentAccounts(currentWeek)
          : Promise.resolve([]),
      ]);

      if (version !== request.current) return;
      setMyAccount(account);
      setMyTransactions(transactions);
      setCommissionerAccounts(accounts);
    } catch (caught) {
      if (version !== request.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The Firebase payment ledger could not be loaded.",
      );
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [commissionerMode, currentWeek, profile, entryId]);

  useEffect(() => {
    void refresh();
    return invalidateRequests;
  }, [refresh, invalidateRequests]);

  const recordPayment = async (
    input: CloudPaymentEntryInput,
  ): Promise<void> => {
    setError("");

    try {
      await recordCloudPaymentTransaction(input);
      await refresh();
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The payment could not be recorded.";
      setError(message);
      throw caught;
    }
  };

  return {
    loading,
    error,
    myAccount,
    myTransactions,
    commissionerAccounts,
    refresh,
    loadTransactions: fetchPaymentTransactionsForUid,
    recordPayment,
  };
}
