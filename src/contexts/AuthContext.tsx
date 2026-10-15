import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authRedirects, isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile } from '@/types/db';

interface AuthResult {
  error: string | null;
  /** Present when the caller must still confirm their email before signing in. */
  needsEmailConfirmation?: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** True once the user has confirmed their email address. */
  emailVerified: boolean;
  signUp: (args: { fullName: string; email: string; password: string }) => Promise<AuthResult>;
  signIn: (args: { email: string; password: string }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  resendVerification: (email: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Turn raw Supabase errors into short, human-readable messages. */
function humanError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (m.includes('email not confirmed')) return 'Please confirm your email address first.';
  if (m.includes('user already registered')) return 'An account with this email already exists.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a moment and try again.';
  if (m.includes('failed to fetch') || m.includes('network'))
    return 'Network error. Check your connection and try again.';
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error) setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) void loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) void loadProfile(next.user.id);
      else setProfile(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback<AuthContextValue['signUp']>(
    async ({ fullName, email, password }) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: fullName.trim() },
          emailRedirectTo: authRedirects.emailConfirm,
        },
      });
      if (error) return { error: humanError(error.message) };
      // If email confirmation is enabled, there is no session yet.
      const needsEmailConfirmation = !data.session;
      return { error: null, needsEmailConfirmation };
    },
    [],
  );

  const signIn = useCallback<AuthContextValue['signIn']>(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { error: humanError(error.message) };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(
    async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRedirects.passwordReset,
      });
      if (error) return { error: humanError(error.message) };
      return { error: null };
    },
    [],
  );

  const updatePassword = useCallback<AuthContextValue['updatePassword']>(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: humanError(error.message) };
    return { error: null };
  }, []);

  const resendVerification = useCallback<AuthContextValue['resendVerification']>(
    async (email) => {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: authRedirects.emailConfirm },
      });
      if (error) return { error: humanError(error.message) };
      return { error: null };
    },
    [],
  );

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      emailVerified: Boolean(session?.user?.email_confirmed_at),
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerification,
      refreshProfile,
    }),
    [
      session,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendVerification,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
