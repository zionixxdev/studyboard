import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute';
import { isSupabaseConfigured } from '@/lib/supabase';
import SetupNotice from '@/pages/SetupNotice';
import Login from '@/pages/Login';
import Signup from '@/pages/Signup';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import VerifyEmail from '@/pages/VerifyEmail';
import Dashboard from '@/pages/Dashboard';
import Room from '@/pages/Room';
import Profile from '@/pages/Profile';
import JoinRedirect from '@/pages/JoinRedirect';
import Terms from '@/pages/Terms';
import Privacy from '@/pages/Privacy';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <>
      {/* Decorative ambient background behind everything. */}
      <div className="app-ambient" aria-hidden="true" />

      {/* If Supabase isn't configured the app refuses to fake it and instead
          explains exactly what to set up. */}
      {!isSupabaseConfigured ? (
        <SetupNotice />
      ) : (
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Public, signed-out only */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>

          {/* Public, but meaningful while signed in too */}
          <Route path="/verify" element={<VerifyEmail />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/room/:roomId" element={<Room />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/join" element={<JoinRedirect />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      )}
    </>
  );
}
