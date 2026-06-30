'use client';

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '@/lib/platform/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message ?? 'Something went wrong');
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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Forgot password?</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6, textAlign: 'center', maxWidth: 280 }}>
            {sent ? "If that email exists we've sent a reset link. Check your inbox." : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        {!sent ? (
          <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #27272a', borderRadius: 14, padding: '28px 24px' }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Email address</label>
                <input
                  type="email" autoComplete="email" required value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #3f3f46', background: 'var(--bld-bg-elevated)', color: 'var(--bld-text-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms' }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#3f3f46')}
                />
              </div>
              {error && (
                <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity 150ms' }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </div>
        ) : (
          <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #27272a', borderRadius: 14, padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
            <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>
              Check your inbox at <strong style={{ color: '#cbd5e1' }}>{email}</strong> for the reset link. It expires in 1 hour.
            </p>
          </div>
        )}

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
          <Link to="/login" style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
