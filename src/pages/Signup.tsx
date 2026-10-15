import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordField } from '@/components/auth/PasswordField';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAuth } from '@/contexts/AuthContext';
import { checkPassword, isValidEmail } from '@/lib/utils';

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (fullName.trim().length < 2) return setError('Enter your name (at least 2 characters).');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!checkPassword(password).ok) return setError(checkPassword(password).problems[0]);
    if (password !== confirm) return setError('Passwords do not match.');
    if (!accepted) return setError('Please accept the Terms and Privacy Policy.');

    setSubmitting(true);
    const { error: err, needsEmailConfirmation } = await signUp({
      fullName,
      email,
      password,
    });
    setSubmitting(false);

    if (err) return setError(err);

    if (needsEmailConfirmation) {
      // No session yet — email confirmation is required.
      navigate('/verify', { replace: true, state: { email: email.trim(), justSignedUp: true } });
    } else {
      navigate('/dashboard', { replace: true });
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Study together in shared rooms."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <GlassInput
          label="Full name"
          autoComplete="name"
          placeholder="Aditya Shakya"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <GlassInput
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          placeholder="At least 8 characters"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
        />
        <PasswordField
          label="Confirm password"
          placeholder="Repeat your password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : null}
        />

        <label className="flex items-start gap-2.5 text-sm text-soft">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-glass-border/40 bg-glass-bg/40 accent-accent"
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" className="text-accent hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <GlassButton type="submit" block loading={submitting} disabled={submitting}>
          Create account
        </GlassButton>
      </form>
    </AuthLayout>
  );
}
