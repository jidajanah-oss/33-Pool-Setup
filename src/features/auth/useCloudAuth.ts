import { useCallback, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  app,
  auth,
  db,
  isFirebaseConfigured,
  requireFirebaseAuth,
  requireFirestore,
} from "../../lib/firebase";
import type { CloudProfile } from "../../types/cloud";
import {
  getCloudRoleForUid,
  PRIMARY_COMMISSIONER_EMAIL,
} from "../../services/cloudRoleService";

const OTP_EMAIL_STORAGE_KEY = "33-pool-otp-email";
const NAME_STORAGE_KEY = "33-pool-firebase-display-name";

interface RequestOtpResponse {
  maskedEmail: string;
  expiresInSeconds: number;
}

interface VerifyOtpResponse {
  customToken: string;
  email: string;
}

export interface CloudAuthController {
  configured: boolean;
  loading: boolean;
  session: User | null;
  user: User | null;
  profile: CloudProfile | null;
  error: string;
  otpSentTo: string;
  prepareOtp: (
    email: string,
    displayName: string,
  ) => Promise<void>;
  requestOtp: (
    email: string,
    displayName: string,
  ) => Promise<void>;
  verifyOtp: (
    email: string,
    code: string,
  ) => Promise<void>;
  clearOtpRequest: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

function cleanDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCredentials(
  email: string,
  displayName: string,
): {
  email: string;
  displayName: string;
} {
  const cleanEmail = email.trim().toLowerCase();
  const savedName = cleanDisplayName(
    window.localStorage.getItem(NAME_STORAGE_KEY) ?? "",
  );
  const cleanName =
    cleanDisplayName(displayName) || savedName;

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
    cleanEmail.length > 254
  ) {
    throw new Error("Enter a valid email address.");
  }

  if (cleanName.length < 2 || cleanName.length > 40) {
    throw new Error("Enter the player's name.");
  }

  return {
    email: cleanEmail,
    displayName: cleanName,
  };
}

async function findLatestInvite(
  email: string,
): Promise<{
  id: string;
  displayName: string;
  status: string;
} | null> {
  if (!email) {
    return null;
  }

  const firestore = requireFirestore();
  const snapshots = await getDocs(
    query(
      collection(firestore, "invites"),
      where("email", "==", email),
    ),
  );

  const matches = snapshots.docs
    .map((snapshot) => ({
      id: snapshot.id,
      displayName:
        typeof snapshot.data().displayName === "string"
          ? snapshot.data().displayName
          : "",
      status:
        typeof snapshot.data().status === "string"
          ? snapshot.data().status
          : "pending",
      sentAt:
        typeof snapshot.data().sentAt === "string"
          ? snapshot.data().sentAt
          : "",
    }))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return matches[0] ?? null;
}

async function loadOrCreateProfile(
  user: User,
): Promise<CloudProfile> {
  const firestore = requireFirestore();
  const userRef = doc(firestore, "users", user.uid);
  const email = user.email?.trim().toLowerCase() ?? "";

  const [userSnapshot, invite] = await Promise.all([
    getDoc(userRef),
    findLatestInvite(email),
  ]);

  const now = new Date().toISOString();
  const savedName = cleanDisplayName(
    window.localStorage.getItem(NAME_STORAGE_KEY) ?? "",
  );
  const invitedName = cleanDisplayName(
    invite?.displayName ?? "",
  );
  const fallbackName =
    user.displayName?.trim() ||
    user.email?.split("@")[0]?.replace(/[._-]+/g, " ") ||
    "Player";
  const newProfileName =
    savedName.length >= 2
      ? savedName
      : invitedName.length >= 2
        ? invitedName
        : fallbackName;
  const existingName =
    userSnapshot.exists() &&
    typeof userSnapshot.data().displayName === "string"
      ? userSnapshot.data().displayName
      : "";
  const displayName = existingName || newProfileName;

  if (!userSnapshot.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      displayName,
      email,
      createdAt: now,
      updatedAt: now,
    });
  } else if (
    savedName.length >= 2 &&
    userSnapshot.data().displayName !== savedName
  ) {
    await setDoc(
      userRef,
      {
        uid: user.uid,
        displayName: savedName,
        email,
        createdAt:
          typeof userSnapshot.data().createdAt === "string"
            ? userSnapshot.data().createdAt
            : now,
        updatedAt: now,
      },
      { merge: false },
    );
  }

  if (invite && invite.status !== "signed_in") {
    await updateDoc(doc(firestore, "invites", invite.id), {
      status: "signed_in",
      linkedUid: user.uid,
      linkedAt: now,
    });
  }

  const [refreshedUser, resolvedRole] = await Promise.all([
    getDoc(userRef),
    getCloudRoleForUid(user.uid, user.email),
  ]);
  const data = refreshedUser.data();
  const role =
    email === PRIMARY_COMMISSIONER_EMAIL
      ? "primary_commissioner"
      : resolvedRole;

  return {
    id: user.uid,
    display_name:
      typeof data?.displayName === "string"
        ? data.displayName
        : displayName,
    role,
    created_at:
      typeof data?.createdAt === "string"
        ? data.createdAt
        : now,
    updated_at:
      typeof data?.updatedAt === "string"
        ? data.updatedAt
        : now,
  };
}

export function useCloudAuth(): CloudAuthController {
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] =
    useState<CloudProfile | null>(null);
  const [error, setError] = useState("");
  const [otpSentTo, setOtpSentTo] = useState(() =>
    window.localStorage.getItem(OTP_EMAIL_STORAGE_KEY) ?? "",
  );

  const loadProfile = useCallback(
    async (nextUser: User | null) => {
      if (!nextUser) {
        setProfile(null);
        return;
      }

      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (attempt > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 800);
            });
          }

          setProfile(await loadOrCreateProfile(nextUser));
          setError("");
          return;
        } catch (caught) {
          lastError = caught;
        }
      }

      setProfile(null);
      setError(
        lastError instanceof Error
          ? lastError.message
          : "The Firebase player profile could not be loaded.",
      );
    },
    [],
  );
  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const firestore = requireFirestore();
    let active = true;
    let refreshQueued = false;

    const refreshCurrentProfile = () => {
      if (!active || refreshQueued) {
        return;
      }

      refreshQueued = true;

      window.setTimeout(() => {
        refreshQueued = false;

        if (active) {
          void loadProfile(user);
        }
      }, 0);
    };

    const unsubscribeAdmin = onSnapshot(
      doc(firestore, "admins", user.uid),
      refreshCurrentProfile,
      () => refreshCurrentProfile(),
    );

    const unsubscribeTeam = onSnapshot(
      doc(firestore, "commissionerTeam", "main"),
      refreshCurrentProfile,
      () => refreshCurrentProfile(),
    );

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshCurrentProfile();
      }
    };

    window.addEventListener("focus", refreshCurrentProfile);
    window.addEventListener("pageshow", refreshCurrentProfile);
    document.addEventListener(
      "visibilitychange",
      refreshWhenVisible,
    );

    return () => {
      active = false;
      unsubscribeAdmin();
      unsubscribeTeam();
      window.removeEventListener("focus", refreshCurrentProfile);
      window.removeEventListener("pageshow", refreshCurrentProfile);
      document.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
    };
  }, [loadProfile, user]);

  useEffect(() => {
    const firebaseAuth = auth;

    if (!firebaseAuth || !db) {
      setLoading(false);
      return;
    }

    let active = true;

    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        if (!active) {
          return;
        }

        setUser(nextUser);
        void loadProfile(nextUser).finally(() => {
          if (active) {
            setLoading(false);
          }
        });
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const prepareOtp = async (
    email: string,
    displayName: string,
  ): Promise<void> => {
    const credentials = normalizeCredentials(
      email,
      displayName,
    );

    window.localStorage.setItem(
      OTP_EMAIL_STORAGE_KEY,
      credentials.email,
    );
    window.localStorage.setItem(
      NAME_STORAGE_KEY,
      credentials.displayName,
    );
    setOtpSentTo(credentials.email);
    setError("");
  };

  const requestOtp = async (
    email: string,
    displayName: string,
  ): Promise<void> => {
    const credentials = normalizeCredentials(
      email,
      displayName,
    );
    const functions = getFunctions(app, "us-east1");
    const requestCode = httpsCallable<
      {
        email: string;
        displayName: string;
        purpose: "sign_in";
      },
      RequestOtpResponse
    >(functions, "request33PoolOtp");

    setError("");

    await requestCode({
      email: credentials.email,
      displayName: credentials.displayName,
      purpose: "sign_in",
    });

    window.localStorage.setItem(
      OTP_EMAIL_STORAGE_KEY,
      credentials.email,
    );
    window.localStorage.setItem(
      NAME_STORAGE_KEY,
      credentials.displayName,
    );
    setOtpSentTo(credentials.email);
  };

  const verifyOtp = async (
    email: string,
    code: string,
  ): Promise<void> => {
    const firebaseAuth = requireFirebaseAuth();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.replace(/\D/g, "");

    if (!cleanEmail) {
      throw new Error("Enter the email that received the code.");
    }

    if (cleanCode.length !== 6) {
      throw new Error("Enter the complete 6-digit code.");
    }

    const functions = getFunctions(app, "us-east1");
    const verifyCode = httpsCallable<
      { email: string; code: string },
      VerifyOtpResponse
    >(functions, "verify33PoolOtp");
    const result = await verifyCode({
      email: cleanEmail,
      code: cleanCode,
    });

    if (!result.data.customToken) {
      throw new Error(
        "Firebase did not return a secure sign-in token.",
      );
    }

    await signInWithCustomToken(
      firebaseAuth,
      result.data.customToken,
    );

    window.localStorage.removeItem(OTP_EMAIL_STORAGE_KEY);
    setOtpSentTo("");
    setError("");
  };

  const clearOtpRequest = () => {
    window.localStorage.removeItem(OTP_EMAIL_STORAGE_KEY);
    setOtpSentTo("");
    setError("");
  };

  const signOut = async (): Promise<void> => {
    const firebaseAuth = requireFirebaseAuth();
    await firebaseSignOut(firebaseAuth);
    setProfile(null);
    setUser(null);
  };

  return {
    configured: isFirebaseConfigured,
    loading,
    session: user,
    user,
    profile,
    error,
    otpSentTo,
    prepareOtp,
    requestOtp,
    verifyOtp,
    clearOtpRequest,
    signOut,
    refreshProfile,
  };
}
