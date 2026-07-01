'use client';

import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';

import { AuthProvider } from './platform/_auth-provider';
import { PrivateRoute, PublicOnlyRoute } from './platform/_route-guards';
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
  // Subdomain-based preview: <projectId>.app.mythex.ai or <projectId>.staging.app.mythex.ai
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isPreview =
      /^[^.]+\.app\.mythex\.ai$/.test(host) ||
      /^[^.]+\.staging\.app\.mythex\.ai$/.test(host);
    if (isPreview) return <PreviewRouter />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public-only routes — redirect to /workspaces if already logged in */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="login" element={<LoginPage />} />
            <Route path="signup" element={<SignupPage />} />
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
          </Route>

          {/* Protected platform pages — sidebar layout */}
          <Route element={<PrivateRoute />}>
            <Route element={<PlatformLayout />}>
              <Route index element={<Navigate to="/workspaces" replace />} />
              <Route path="workspaces" element={<WorkspacesPage />} />
              <Route path="workspaces/:workspaceId" element={<WorkspaceDetailPage />} />
              <Route path="builder/:projectId" element={<BuilderRedirect />} />
            </Route>
          </Route>

          {/* Protected builder — full-screen, no sidebar */}
          <Route element={<PrivateRoute />}>
            <Route
              path="dev/builder"
              element={
                <Suspense fallback={null}>
                  <BuilderPage />
                </Suspense>
              }
            />
          </Route>

          {/* Neutral — accessible with or without auth */}
          <Route path="invitations/accept" element={<InvitationsAcceptPage />} />
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
      </AuthProvider>
    </BrowserRouter>
  );
}
