'use client';

import { useState, type FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/platform/api-client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const prefillEmail = searchParams.get('email') ?? '';

  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login({ email, password });
      if (inviteToken) {
        router.push(`/invitations/accept?token=${encodeURIComponent(inviteToken)}`);
      } else {
        router.push('/workspaces');
      }
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b1120' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f9fafb', margin: 0 }}>Sign in</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            {inviteToken ? 'Sign in to accept your invitation' : 'Welcome back to Builder Platform'}
          </p>
        </div>

        <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 14, padding: '28px 24px' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Email</label>
              <input
                type="email" autoComplete="email" required value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Password</label>
              <input
                type="password" autoComplete="current-password" required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #374151', background: '#1f2937', color: '#f9fafb', fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>

            {error && (
              <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, marginTop: 4, transition: 'background 150ms' }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
          Don&apos;t have an account?{' '}
          <Link
            href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : '/signup'}
            style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
