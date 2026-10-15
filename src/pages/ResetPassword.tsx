import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordField } from '@/components/auth/PasswordField';
import { GlassButton } from '@/components/ui/GlassButton';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { checkPassword } from '@/lib/utils';

/**
 * Landing page for the password-recovery email link.
 *
 * Supabase puts a `code` (PKCE) or a recovery token in the URL and the client
 * library exchanges it for a short-lived session automatically (detectSessionInUrl).
 * We wait for that session, then let the user set a new password.
 */
export default function ResetPassword() {
  const { updatePassword, session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [waited, setWaited] = useState(false);

  // Give the client a moment to consume the recovery link.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!checkPassword(password).ok) return setError(checkPassword(password).problems[0]);
    if (password !== confirm) return setError('Passwords do not match.');

    setSubmitting(true);
    const { error: err } = await updatePassword(password);
    setSubmitting(false);
    if (err) return setError(err);
    setDone(true);
    setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
  }

  const noSession = !loading && waited && !session;

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a strong password you don't use elsewhere."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <p className="text-sm text-success">Password updated. Redirecting to your dashboard…</p>
      ) : noSession ? (
        <div className="space-y-3 text-sm text-soft">
          <p>
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <Link
            to="/forgot-password"
            className="inline-block font-medium text-accent hover:underline"
          >
            Request a new link
          </Link>
        </div>
      ) : loading || !waited ? (
        <div className="flex items-center gap-3 text-sm text-soft">
          <Spinner size={18} /> Verifying your reset link…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <PasswordField
            label="New password"
            placeholder="At least 8 characters"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
          />
          <PasswordField
            label="Confirm new password"
            placeholder="Repeat your password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : null}
          />
          {error && (
            <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <GlassButton type="submit" block loading={submitting} disabled={submitting}>
            Update password
          </GlassButton>
        </form>
      )}
    </AuthLayout>
  );
}
