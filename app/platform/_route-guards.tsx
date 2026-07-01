'use client';

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './_auth-provider';

/**
 * Allows access only when NOT authenticated.
 * Authenticated users are redirected to /workspaces.
 * Use for: login, signup, forgot-password, reset-password.
 */
export function PublicOnlyRoute() {
  const { user } = useAuth();
  return user ? <Navigate to="/workspaces" replace /> : <Outlet />;
}

/**
 * Allows access only when authenticated.
 * Unauthenticated users are redirected to /login.
 * Use for: workspaces, builder, and any protected page.
 */
export function PrivateRoute() {
  const { user } = useAuth();
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
