'use client';

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';

import PlatformLayout from './platform/_layout';
import LoginPage from './platform/login';
import SignupPage from './platform/signup';
import ForgotPasswordPage from './platform/forgot-password';
import ResetPasswordPage from './platform/reset-password';
import WorkspacesPage from './platform/workspaces';
import WorkspaceDetailPage from './platform/workspace-detail';
import InvitationsAcceptPage from './platform/invitations-accept';

const BuilderPage = lazy(() => import('./dev/builder/_builder-page'));
const AppPreviewLoader = lazy(() => import('./app-preview/[[...slug]]/_loader'));

function BuilderRedirect() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  useEffect(() => {
    if (projectId) navigate(`/dev/builder?projectId=${projectId}`, { replace: true });
  }, [navigate, projectId]);
  return null;
}

function PreviewRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="*"
          element={
            <Suspense fallback={null}>
              <AppPreviewLoader />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default function AppRouter() {
  // Subdomain-based preview: *.preview.localhost or *-preview.* → serve preview only
  if (typeof window !== 'undefined' && window.location.hostname.includes('-preview.')) {
    return <PreviewRouter />;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Platform routes — auth-aware layout with sidebar */}
        <Route element={<PlatformLayout />}>
          <Route index element={<Navigate to="/workspaces" replace />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
          <Route path="invitations/accept" element={<InvitationsAcceptPage />} />
          <Route path="builder/:projectId" element={<BuilderRedirect />} />
        </Route>

        {/* Builder — full-screen, no platform layout */}
        <Route
          path="dev/builder"
          element={
            <Suspense fallback={null}>
              <BuilderPage />
            </Suspense>
          }
        />

        {/* App preview */}
        <Route
          path="app-preview/*"
          element={
            <Suspense fallback={null}>
              <AppPreviewLoader />
            </Suspense>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
