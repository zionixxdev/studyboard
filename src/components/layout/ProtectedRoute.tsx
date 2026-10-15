import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageSpinner } from '@/components/ui/Spinner';

/**
 * Guards authenticated routes. Unauthenticated visitors are redirected to
 * /login (remembering where they were headed). Users who have not confirmed
 * their email are sent to /verify.
 *
 * NOTE: this is a UX guard only. The real enforcement lives in Postgres Row
 * Level Security — a client can always be tampered with.
 */
export function ProtectedRoute({ requireVerified = true }: { requireVerified?: boolean }) {
  const { loading, session, emailVerified } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (requireVerified && !emailVerified) return <Navigate to="/verify" replace />;

  return <Outlet />;
}

/** Sends already-authenticated users away from the auth pages. */
export function PublicOnlyRoute() {
  const { loading, session, emailVerified } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (session) return <Navigate to={emailVerified ? '/dashboard' : '/verify'} replace />;
  return <Outlet />;
}
