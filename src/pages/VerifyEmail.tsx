import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAuth } from '@/contexts/AuthContext';
import { isValidEmail } from '@/lib/utils';

/**
 * Shown after signup (email confirmation pending) and when a signed-in user
 * has not yet confirmed their email. Resending is rate-limited by Supabase.
 */
export default function VerifyEmail() {
  const { resendVerification, signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { email?: string; justSignedUp?: boolean } | null;

  const [email, setEmail] = useState(state?.email ?? user?.email ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function resend() {
    if (submitting) return;
    setError(null);
    setMessage(null);
    if (!isValidEmail(email)) return setError('Enter the email you signed up with.');
    setSubmitting(true);
    const { error: err } = await resendVerification(email);
    setSubmitting(false);
    if (err) return setError(err);
    setMessage('Verification email sent. Check your inbox and spam folder.');
  }

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle="We sent you a link to verify your address. Open it to activate your account."
      footer={
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
          className="font-medium text-accent hover:underline"
        >
          Back to sign in
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-soft">
          Didn't get the email? Confirm the address below and we'll send another link.
        </p>
        <GlassInput
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {message && (
          <p role="status" className="rounded-xl bg-success/15 px-3 py-2 text-sm text-success">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <GlassButton block loading={submitting} disabled={submitting} onClick={resend}>
          Resend verification email
        </GlassButton>
        <p className="text-xs text-faint">
          After confirming, you can{' '}
          <Link to="/login" className="text-accent hover:underline">
            sign in
          </Link>{' '}
          with your password.
        </p>
      </div>
    </AuthLayout>
  );
}
