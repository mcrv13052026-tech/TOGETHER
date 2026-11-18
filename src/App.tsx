import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AlbumsPage } from './pages/AlbumsPage';
import { AuthPage } from './pages/AuthPage';
import { ExplorePage } from './pages/ExplorePage';
import { HomeFeedPage } from './pages/HomeFeedPage';
import { InviteAcceptPage } from './pages/InviteAcceptPage';
import { MessagesPage } from './pages/MessagesPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReelsPage } from './pages/ReelsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoriesPage } from './pages/StoriesPage';
import { TermsPage } from './pages/TermsPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

function AppRoutes() {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-500 text-sm">
        Loading TogetherSpace...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/invite/:token" element={<InviteAcceptPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {!user ? (
        <>
          <Route path="*" element={<AuthPage />} />
        </>
      ) : (
        <>
          <Route
            path="/"
            element={
              <AppShell>
                <HomeFeedPage />
              </AppShell>
            }
          />
          <Route
            path="/explore"
            element={
              <AppShell>
                <ExplorePage />
              </AppShell>
            }
          />
          <Route
            path="/reels"
            element={
              <AppShell>
                <ReelsPage />
              </AppShell>
            }
          />
          <Route
            path="/stories"
            element={
              <AppShell>
                <StoriesPage />
              </AppShell>
            }
          />
          <Route
            path="/messages"
            element={
              <AppShell>
                <MessagesPage />
              </AppShell>
            }
          />
          <Route
            path="/albums"
            element={
              <AppShell>
                <AlbumsPage />
              </AppShell>
            }
          />
          <Route
            path="/profile"
            element={
              <AppShell>
                <ProfilePage />
              </AppShell>
            }
          />
          <Route
            path="/settings"
            element={
              <AppShell>
                <SettingsPage />
              </AppShell>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
