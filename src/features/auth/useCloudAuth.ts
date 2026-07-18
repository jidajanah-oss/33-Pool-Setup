import { useCallback, useEffect, useState } from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  auth,
  db,
  isFirebaseConfigured,
  requireFirebaseAuth,
  requireFirestore,
} from "../../lib/firebase";
import type { CloudProfile, CloudRole } from "../../types/cloud";

const EMAIL_STORAGE_KEY = "33-pool-firebase-email";
const NAME_STORAGE_KEY = "33-pool-firebase-display-name";

export interface CloudAuthController {
  configured: boolean;
  loading: boolean;
  session: User | null;
  user: User | null;
  profile: CloudProfile | null;
  error: string;
  magicLinkSentTo: string;
  signInWithMagicLink: (email: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

function cleanDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

async function loadOrCreateProfile(user: User): Promise<CloudProfile> {
  const firestore = requireFirestore();
  const userRef = doc(firestore, "users", user.uid);
  const adminRef = doc(firestore, "admins", user.uid);

  const [userSnapshot, adminSnapshot] = await Promise.all([
    getDoc(userRef),
    getDoc(adminRef),
  ]);

  const now = new Date().toISOString();
  const savedName = cleanDisplayName(
    window.localStorage.getItem(NAME_STORAGE_KEY) ?? "",
  );
  const fallbackName =
    user.displayName?.trim() ||
    user.email?.split("@")[0]?.replace(/[._-]+/g, " ") ||
    "Player";
  const displayName = savedName.length >= 2 ? savedName : fallbackName;
  const email = user.email?.trim().toLowerCase() ?? "";

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

  const refreshedUser = await getDoc(userRef);
  const data = refreshedUser.data();
  const adminData = adminSnapshot.data();
  const role: CloudRole =
    adminSnapshot.exists() && adminData?.role === "co_commissioner"
      ? "co_commissioner"
      : adminSnapshot.exists()
        ? "primary_commissioner"
        : "player";

  return {
    id: user.uid,
    display_name:
      typeof data?.displayName === "string" ? data.displayName : displayName,
    role,
    created_at:
      typeof data?.createdAt === "string" ? data.createdAt : now,
    updated_at:
      typeof data?.updatedAt === "string" ? data.updatedAt : now,
  };
}

export function useCloudAuth(): CloudAuthController {
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [error, setError] = useState("");
  const [magicLinkSentTo, setMagicLinkSentTo] = useState("");

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null);
      return;
    }

    try {
      setProfile(await loadOrCreateProfile(nextUser));
      setError("");
    } catch (caught) {
      setProfile(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "The Firebase player profile could not be loaded.",
      );
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  useEffect(() => {
    const firebaseAuth = auth;

    if (!firebaseAuth || !db) {
      setLoading(false);
      return;
    }

    let active = true;

    const completeEmailLink = async () => {
      try {
        if (isSignInWithEmailLink(firebaseAuth, window.location.href)) {
          let email = window.localStorage.getItem(EMAIL_STORAGE_KEY) ?? "";

          if (!email) {
            email =
              window.prompt(
                "Confirm the email address that received this 33 Pool sign-in link:",
              )?.trim() ?? "";
          }

          if (!email) {
            throw new Error(
              "Enter the same email address that received the sign-in link.",
            );
          }

          await signInWithEmailLink(firebaseAuth, email, window.location.href);
          window.localStorage.removeItem(EMAIL_STORAGE_KEY);

          const cleanUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The Firebase sign-in link could not be completed.",
          );
          setLoading(false);
        }
      }
    };

    void completeEmailLink();

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      if (!active) {
        return;
      }

      setUser(nextUser);
      void loadProfile(nextUser).finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const signInWithMagicLink = async (
    email: string,
    displayName: string,
  ): Promise<void> => {
    const firebaseAuth = requireFirebaseAuth();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = cleanDisplayName(displayName);

    if (!cleanEmail.includes("@")) {
      throw new Error("Enter a valid email address.");
    }

    if (cleanName.length < 2 || cleanName.length > 40) {
      throw new Error("Enter the player's name.");
    }

    setError("");
    setMagicLinkSentTo("");

    window.localStorage.setItem(EMAIL_STORAGE_KEY, cleanEmail);
    window.localStorage.setItem(NAME_STORAGE_KEY, cleanName);

    await sendSignInLinkToEmail(firebaseAuth, cleanEmail, {
      url: `${window.location.origin}${import.meta.env.BASE_URL}`,
      handleCodeInApp: true,
    });

    setMagicLinkSentTo(cleanEmail);
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
    magicLinkSentTo,
    signInWithMagicLink,
    signOut,
    refreshProfile,
  };
}
