import { useCallback, useEffect, useState } from "react";
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
): CloudPaymentState {
  const [loading, setLoading] = useState(Boolean(profile));
  const [error, setError] = useState("");
  const [myAccount, setMyAccount] =
    useState<CloudPaymentState["myAccount"]>(null);
  const [myTransactions, setMyTransactions] = useState<
    CloudPaymentState["myTransactions"]
  >([]);
  const [commissionerAccounts, setCommissionerAccounts] = useState<
    CloudPaymentState["commissionerAccounts"]
  >([]);

  const refresh = useCallback(async () => {
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
      const account = await fetchMyPaymentAccount(currentWeek);
      const [transactions, accounts] = await Promise.all([
        fetchPaymentTransactionsForUid(account.uid),
        commissionerMode
          ? fetchCommissionerPaymentAccounts(currentWeek)
          : Promise.resolve([]),
      ]);

      setMyAccount(account);
      setMyTransactions(transactions);
      setCommissionerAccounts(accounts);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Firebase payment ledger could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [commissionerMode, currentWeek, profile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
