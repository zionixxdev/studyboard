import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordField } from '@/components/auth/PasswordField';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { useAuth } from '@/contexts/AuthContext';
import { isValidEmail } from '@/lib/utils';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // guard against duplicate submits
    setError(null);

    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');

    setSubmitting(true);
    const { error: err } = await signIn({ email, password });
    setSubmitting(false);

    if (err) return setError(err);
    navigate(from, { replace: true });
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue studying."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
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
        <PasswordField
          label="Password"
          placeholder="Your password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-soft hover:text-ink">
            Forgot password?
          </Link>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <GlassButton type="submit" block loading={submitting} disabled={submitting}>
          Sign in
        </GlassButton>
      </form>
    </AuthLayout>
  );
}
