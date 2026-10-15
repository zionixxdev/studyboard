import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Badge';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';

export default function Profile() {
  const { profile, user, signOut, refreshProfile, emailVerified } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (savingProfile) return;
    setProfileMsg(null);
    setSavingProfile(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim(), theme })
      .eq('id', user!.id);
    setSavingProfile(false);
    if (error) setProfileMsg({ ok: false, text: error.message });
    else {
      await refreshProfile();
      setProfileMsg({ ok: true, text: 'Profile updated.' });
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (savingPw) return;
    setPwMsg(null);
    if (newPassword.length < 8) return setPwMsg({ ok: false, text: 'Use at least 8 characters.' });
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPw(false);
    if (error) setPwMsg({ ok: false, text: error.message });
    else {
      setNewPassword('');
      setPwMsg({ ok: true, text: 'Password changed.' });
    }
  }

  async function deleteAccount() {
    if (deleting) return;
    setDeleting(true);
    // Account deletion must run server-side with elevated privileges, so it is
    // implemented as an RPC (delete_own_account) that only deletes the caller.
    const { error } = await supabase.rpc('delete_own_account');
    setDeleting(false);
    if (error) {
      setConfirmDelete(false);
      alert(`Could not delete account: ${error.message}`);
      return;
    }
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile?.display_name ?? user?.email} size={64} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {profile?.display_name ?? 'Your profile'}
            </h1>
            <p className="text-sm text-soft">{user?.email}</p>
            <p className="mt-1 text-xs">
              {emailVerified ? (
                <span className="text-success">Email verified</span>
              ) : (
                <span className="text-danger">Email not verified</span>
              )}
            </p>
          </div>
        </div>

        {/* Profile details */}
        <GlassCard className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-ink">Profile</h2>
          <form onSubmit={saveProfile} className="space-y-4">
            <GlassInput
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-soft">Theme</p>
                <p className="text-xs text-faint">Saved to your profile and this device.</p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as 'dark' | 'light' | 'system')}
                  className="focus-ring rounded-2xl glass-subtle px-3 py-2 text-sm text-ink"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="system">System</option>
                </select>
              </div>
            </div>
            {profileMsg && (
              <p
                className={
                  'rounded-xl px-3 py-2 text-sm ' +
                  (profileMsg.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger')
                }
              >
                {profileMsg.text}
              </p>
            )}
            <GlassButton type="submit" loading={savingProfile} disabled={savingProfile}>
              Save changes
            </GlassButton>
          </form>
        </GlassCard>

        {/* Password */}
        <GlassCard className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-ink">Change password</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <GlassInput
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {pwMsg && (
              <p
                className={
                  'rounded-xl px-3 py-2 text-sm ' +
                  (pwMsg.ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger')
                }
              >
                {pwMsg.text}
              </p>
            )}
            <GlassButton type="submit" variant="ghost" loading={savingPw} disabled={savingPw}>
              Update password
            </GlassButton>
          </form>
        </GlassCard>

        {/* Danger zone */}
        <GlassCard className="p-6">
          <h2 className="mb-2 text-lg font-semibold text-danger">Delete account</h2>
          <p className="mb-4 text-sm text-soft">
            This permanently removes your account, your rooms you own, and your memberships. It
            cannot be undone.
          </p>
          <GlassButton variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete my account
          </GlassButton>
        </GlassCard>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete account?"
        footer={
          <>
            <GlassButton variant="subtle" onClick={() => setConfirmDelete(false)}>
              Cancel
            </GlassButton>
            <GlassButton variant="danger" loading={deleting} onClick={deleteAccount}>
              Yes, delete everything
            </GlassButton>
          </>
        }
      >
        <p className="text-sm">
          This action is permanent. Type-confirmation is intentionally simple; the operation itself
          runs server-side and only ever deletes your own account.
        </p>
      </Modal>
    </AppShell>
  );
}
