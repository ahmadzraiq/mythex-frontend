'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/platform/api-client';

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const result = await auth.register({ name, email, password });
      router.push(`/workspaces/${result.defaultWorkspaceId}?section=projects`);
    } catch (err) {
      setError((err as Error).message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid #374151', background: '#1f2937',
    color: '#f9fafb', fontSize: 13, outline: 'none',
    boxSizing: 'border-box' as const, transition: 'border-color 150ms',
  };

  const heroGradientText: CSSProperties = {
    background: 'linear-gradient(135deg, #93c5fd 0%, #c4b5fd 100%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 20px',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        backgroundColor: '#070b14',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            top: '-15%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(100vw, 640px)',
            height: 360,
            background: 'radial-gradient(ellipse 65% 55% at 50% 40%, rgba(59, 130, 246, 0.2), transparent 72%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-8%',
            right: '-12%',
            width: 340,
            height: 340,
            background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.14), transparent 68%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '35%',
            left: '-15%',
            width: 260,
            height: 260,
            background: 'radial-gradient(circle at center, rgba(56, 189, 248, 0.08), transparent 68%)',
          }}
        />
      </div>

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        {/* Hero */}
        <header style={{ textAlign: 'center', marginBottom: 36 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              margin: '0 auto 20px',
              background: 'linear-gradient(145deg, #2563eb 0%, #4f46e5 55%, #7c3aed 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 18px 50px -12px rgba(59, 130, 246, 0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <p
            style={{
              margin: '0 0 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#64748b',
            }}
          >
            Builder Platform
          </p>
          <h1
            style={{
              fontSize: 'clamp(1.65rem, 4.2vw, 2.125rem)',
              fontWeight: 700,
              letterSpacing: '-0.035em',
              lineHeight: 1.18,
              margin: 0,
              color: '#f8fafc',
            }}
          >
            Create your <span style={heroGradientText}>account</span>
          </h1>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.55,
              color: '#94a3b8',
              margin: '14px auto 0',
              maxWidth: 340,
            }}
          >
            Start building faster—visual screens, workflows, and shared components in one workspace.
          </p>
        </header>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Card */}
          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 14, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Full name</label>
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
                className="signup-fullname-input"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Email</label>
              <input
                type="email" autoComplete="email" required value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#9ca3af', marginBottom: 6 }}>Password</label>
              <input
                type="password" autoComplete="new-password" required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters"
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
              />
            </div>

            {error && (
              <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                {error}
              </div>
            )}
          </div>

          <button
            type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'background 150ms' }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
            onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#6b7280' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
