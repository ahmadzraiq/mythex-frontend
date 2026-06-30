'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { auth } from '@/lib/platform/api-client';

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const prefillEmail = searchParams.get('email') ?? '';

  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';
  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login({ email, password });
      if (inviteToken) {
        navigate(`/invitations/accept?token=${encodeURIComponent(inviteToken)}`);
      } else {
        navigate('/workspaces');
      }
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-elevated)',
    color: 'var(--bld-text-1)', fontSize: 13,
    outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#070b14', position: 'relative', overflow: 'hidden' }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 'min(100vw, 640px)', height: 360, background: 'radial-gradient(ellipse 65% 55% at 50% 40%, rgba(59, 130, 246, 0.2), transparent 72%)' }} />
        <div style={{ position: 'absolute', bottom: '-8%', right: '-12%', width: 340, height: 340, background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.14), transparent 68%)' }} />
        <div style={{ position: 'absolute', top: '35%', left: '-15%', width: 260, height: 260, background: 'radial-gradient(circle at center, rgba(56, 189, 248, 0.08), transparent 68%)' }} />
      </div>
      <div style={{ width: '100%', maxWidth: 360, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(145deg, #6366f1 0%, #4f46e5 55%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, boxShadow: '0 12px 32px -8px rgba(99,102,241,0.5)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Sign in</h1>
          <p style={{ fontSize: 13, color: 'var(--bld-text-disabled)', marginTop: 6 }}>
            {inviteToken ? 'Sign in to accept your invitation' : 'Welcome back to Builder Platform'}
          </p>
        </div>

        <a
          href={`${BACKEND_URL}/v1/auth/google${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '10px', borderRadius: 8, boxSizing: 'border-box', border: '1px solid #3f3f46', background: 'var(--bld-bg-panel)', color: '#f1f5f9', fontSize: 13.5, fontWeight: 600, textDecoration: 'none', transition: 'border-color 150ms, background 150ms' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#6b7280'; (e.currentTarget as HTMLAnchorElement).style.background = '#27272a'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--bld-border-subtle)'; (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bld-bg-panel)'; }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.8-6.8C35.7 2.3 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.1 17.7 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.6 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.9 37.6 46.6 31.5 46.6 24.5z"/>
            <path fill="#FBBC05" d="M10.5 28.6A14.4 14.4 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A23.8 23.8 0 0 0 0 24c0 3.8.9 7.4 2.6 10.6l7.9-6z"/>
            <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.2-7.7 2.2-6.3 0-11.6-3.6-13.5-9l-7.9 6C6.6 42.6 14.6 48 24 48z"/>
          </svg>
          Continue with Google
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
          <div style={{ flex: 1, height: '0.5px', background: 'var(--bld-bg-elevated)' }} />
          <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>or</span>
          <div style={{ flex: 1, height: '0.5px', background: 'var(--bld-bg-elevated)' }} />
        </div>

        <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #27272a', borderRadius: 14, padding: '28px 24px' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Email</label>
              <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value.toLowerCase())} placeholder="you@example.com"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} autoComplete="current-password" required value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="Enter your password"
                  style={{ ...inputStyle, paddingRight: 38 }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
                />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bld-text-disabled)', padding: 2, display: 'flex', alignItems: 'center' }}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
              <div style={{ textAlign: 'right', marginTop: 6 }}>
                <Link to="/forgot-password" style={{ fontSize: 11.5, color: '#60a5fa', textDecoration: 'none', fontWeight: 500 }}>
                  Forgot password?
                </Link>
              </div>
            </div>

            {error && (
              <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={!canSubmit}
              style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5, marginTop: 4, transition: 'opacity 150ms, background 150ms' }}
              onMouseEnter={e => { if (canSubmit) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-accent-hover)'; }}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'var(--bld-accent)'}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--bld-text-disabled)' }}>
          Don&apos;t have an account?{' '}
          <Link to={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : '/signup'} style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
