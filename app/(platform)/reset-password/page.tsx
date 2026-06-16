'use client';

import { useState, Suspense, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/platform/api-client';

const PW_RULES = [
  { label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { label: 'One uppercase letter',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number',             test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character',  test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function getStrength(p: string): number {
  return PW_RULES.filter(r => r.test(p)).length;
}

const STRENGTH_COLORS = ['#dc2626', '#f97316', '#eab308', '#22c55e'];

function PasswordStrengthBar({ password }: { password: string }) {
  const score = getStrength(password);
  if (!password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < score ? STRENGTH_COLORS[score - 1] : '#27272a', transition: 'background 200ms' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {PW_RULES.map((rule, i) => {
          const met = rule.test(password);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: met ? '#86efac' : '#6b7280' }}>
              <span style={{ fontSize: 10 }}>{met ? '✓' : '○'}</span>
              {rule.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <div style={{ textAlign: 'center', color: '#f87171', padding: 40 }}>
        Invalid reset link. <Link href="/forgot-password" style={{ color: '#60a5fa' }}>Request a new one.</Link>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (getStrength(password) < 4) {
      setError('Please satisfy all password requirements.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError((err as Error).message ?? 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#070b14' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(145deg, #6366f1 0%, #4f46e5 55%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, boxShadow: '0 12px 32px -8px rgba(99,102,241,0.5)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Set new password</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            {done ? 'Password updated! Redirecting to sign in…' : 'Choose a strong password for your account.'}
          </p>
        </div>

        {!done ? (
          <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #27272a', borderRadius: 14, padding: '28px 24px' }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>New password</label>
                <input type="password" autoComplete="new-password" required value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="Min. 12 characters"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #3f3f46', background: 'var(--bld-bg-elevated)', color: 'var(--bld-text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#3f3f46')}
                />
                <PasswordStrengthBar password={password} />
              </div>
              {error && (
                <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || getStrength(password) < 4}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: (loading || getStrength(password) < 4) ? 'not-allowed' : 'pointer', opacity: (loading || getStrength(password) < 4) ? 0.6 : 1, marginTop: 4 }}
              >
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </div>
        ) : (
          <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #16a34a33', borderRadius: 14, padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, color: '#86efac', margin: 0 }}>Password updated successfully.</p>
          </div>
        )}

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
          <Link href="/login" style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
