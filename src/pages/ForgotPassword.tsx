import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAuth } from '@/contexts/AuthContext';
import { isValidEmail } from '@/lib/utils';

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!isValidEmail(email)) return setError('Enter a valid email address.');

    setSubmitting(true);
    const { error: err } = await requestPasswordReset(email);
    setSubmitting(false);
    if (err) return setError(err);
    setSent(true);
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a secure link to set a new password."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-3 text-sm text-soft">
          <p>
            If an account exists for <span className="text-ink">{email}</span>, a reset link is on
            its way. Check your inbox and spam folder.
          </p>
          <p className="text-faint">
            Email delivery depends on your Supabase project's SMTP configuration — see
            docs/SETUP.md if mail isn't arriving.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <GlassInput
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error && (
            <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <GlassButton type="submit" block loading={submitting} disabled={submitting}>
            Send reset link
          </GlassButton>
        </form>
      )}
    </AuthLayout>
  );
}
