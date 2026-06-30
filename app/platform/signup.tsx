'use client';

import { useState, useRef, useEffect, Suspense, type FormEvent, type CSSProperties, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

import { auth } from '@/lib/platform/api-client';

// ── Eye icon ──────────────────────────────────────────────────────────────────

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

// ── Password input with eye toggle ────────────────────────────────────────────

function PasswordInput({ value, onChange, placeholder, autoComplete, show, onToggle, inputStyle }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  autoComplete?: string; show: boolean; onToggle: () => void;
  inputStyle: CSSProperties;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete ?? 'new-password'}
        required
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        style={{ ...inputStyle, paddingRight: 38 }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--bld-text-disabled)', padding: 2, display: 'flex', alignItems: 'center',
        }}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}

// ── Password strength helpers ─────────────────────────────────────────────────

const PW_RULES = [
  { label: 'At least 12 characters', test: (p: string) => p.length >= 12 },
  { label: 'One uppercase letter',   test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number',             test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character',  test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function getStrength(p: string): number {
  return PW_RULES.filter(r => r.test(p)).length; // 0–4
}

const STRENGTH_COLORS = ['#dc2626', '#f97316', '#eab308', '#22c55e'];
const STRENGTH_LABELS = ['Weak', 'Fair', 'Good', 'Strong'];

function PasswordStrengthBar({ password }: { password: string }) {
  const score = getStrength(password);
  if (!password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i < score ? STRENGTH_COLORS[score - 1] : 'var(--bld-bg-elevated)',
            transition: 'background 200ms',
          }} />
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

// ── OTP Code Input ─────────────────────────────────────────────────────────────

function OtpInput({ onComplete }: { onComplete: (code: string) => void }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function updateDigit(idx: number, val: string) {
    const d = [...digits];
    d[idx] = val.slice(-1);
    setDigits(d);
    if (val && idx < 5) refs.current[idx + 1]?.focus();
    const code = d.join('');
    if (code.length === 6 && d.every(c => /\d/.test(c))) onComplete(code);
  }

  function handleKey(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const d = pasted.split('').concat(Array(6).fill('')).slice(0, 6);
    setDigits(d);
    const filled = d.filter(Boolean).length;
    refs.current[Math.min(filled, 5)]?.focus();
    if (pasted.length === 6) onComplete(pasted);
  }

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          value={d}
          onChange={e => updateDigit(i, e.target.value.replace(/\D/, ''))}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
          style={{
            width: 44, height: 52, textAlign: 'center',
            fontSize: 22, fontWeight: 700, letterSpacing: 0,
            borderRadius: 10, border: '1.5px solid var(--bld-border-subtle)',
            background: 'var(--bld-bg-elevated)', color: 'var(--bld-text-1)',
            outline: 'none', caretColor: 'var(--bld-accent)',
            transition: 'border-color 150ms',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
        />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function SignupContent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') ?? '';
  const prefillEmail = searchParams.get('email') ?? '';

  const jumpToVerify = searchParams.get('verify') === '1';
  const [step, setStep] = useState<'form' | 'verify'>(jumpToVerify ? 'verify' : 'form');

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefillEmail);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Verify step state
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // When arriving at verify step via redirect (?verify=1), email state may be empty — fetch it
  useEffect(() => {
    if (step === 'verify' && !email) {
      auth.me().then(({ user: u }) => setEmail(u.email)).catch(() => {});
    }
  }, [step, email]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (getStrength(password) < 4) {
      setError('Please satisfy all password requirements.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await auth.register({ name, email, password });
      setStep('verify');
    } catch (err) {
      setError((err as Error).message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(code: string) {
    setVerifyError('');
    setVerifying(true);
    try {
      await auth.verifyEmail(email, code);
      if (inviteToken) {
        navigate(`/invitations/accept?token=${encodeURIComponent(inviteToken)}`);
      } else {
        navigate('/workspaces');
      }
    } catch (err) {
      setVerifyError((err as Error).message ?? 'Invalid code');
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    try {
      await auth.resendVerification(email);
      setResendCooldown(60);
      setVerifyError('');
    } catch (err) {
      setVerifyError((err as Error).message ?? 'Could not resend');
    }
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid var(--bld-border-subtle)', background: 'var(--bld-bg-elevated)',
    color: 'var(--bld-text-1)', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', transition: 'border-color 150ms',
  };

  const heroGradientText: CSSProperties = {
    background: 'linear-gradient(135deg, #93c5fd 0%, #c4b5fd 100%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 20px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      backgroundColor: '#070b14', position: 'relative', overflow: 'hidden',
    }}>
      {/* Background blobs */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: 'min(100vw, 640px)', height: 360, background: 'radial-gradient(ellipse 65% 55% at 50% 40%, rgba(59, 130, 246, 0.2), transparent 72%)' }} />
        <div style={{ position: 'absolute', bottom: '-8%', right: '-12%', width: 340, height: 340, background: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.14), transparent 68%)' }} />
      </div>

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto 20px', background: 'linear-gradient(145deg, #6366f1 0%, #4f46e5 55%, #7c3aed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 18px 50px -12px rgba(59, 130, 246, 0.45), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', color: '#64748b' }}>Builder Platform</p>
          <h1 style={{ fontSize: 'clamp(1.65rem, 4.2vw, 2.125rem)', fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.18, margin: 0, color: '#f8fafc' }}>
            {step === 'verify'
              ? <>Check your <span style={heroGradientText}>email</span></>
              : inviteToken ? <>Accept your <span style={heroGradientText}>invitation</span></> : <>Create your <span style={heroGradientText}>account</span></>
            }
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--bld-text-3)', margin: '14px auto 0', maxWidth: 340 }}>
            {step === 'verify'
              ? (email ? <>We sent a 6-digit code to <strong style={{ color: '#cbd5e1' }}>{email}</strong></> : 'Enter the 6-digit code we sent to your email address.')
              : inviteToken ? 'Create a free account to join the workspace you were invited to.' : 'Start building faster—visual screens, workflows, and shared components in one workspace.'
            }
          </p>
        </header>

        {step === 'form' ? (
          <>
            {/* Google button */}
            <a
              href={`${BACKEND_URL}/v1/auth/google${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                width: '100%', padding: '10px', borderRadius: 8,
                border: '1px solid #3f3f46', background: 'var(--bld-bg-panel)',
                color: '#f1f5f9', fontSize: 13.5, fontWeight: 600,
                textDecoration: 'none', boxSizing: 'border-box',
                transition: 'border-color 150ms, background 150ms',
              }}
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

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--bld-bg-elevated)' }} />
              <span style={{ fontSize: 11, color: 'var(--bld-text-disabled)' }}>or</span>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--bld-bg-elevated)' }} />
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid #27272a', borderRadius: 14, padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Full name</label>
                  <input type="text" autoComplete="name" required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe"
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent)')}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Email</label>
                  <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value.toLowerCase())} placeholder="you@example.com"
                    readOnly={!!prefillEmail}
                    style={{ ...inputStyle, ...(prefillEmail ? { color: 'var(--bld-text-disabled)', cursor: 'default' } : {}) }}
                    onFocus={e => { if (!prefillEmail) e.currentTarget.style.borderColor = 'var(--bld-accent)'; }}
                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>Password</label>
                  <PasswordInput
                    value={password} onChange={setPassword}
                    placeholder="Enter a password" autoComplete="new-password"
                    show={showPw} onToggle={() => setShowPw(v => !v)}
                    inputStyle={inputStyle}
                  />
                  <PasswordStrengthBar password={password} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 6 }}>
                    Confirm password
                    {confirm && password && confirm !== password && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#f87171', fontWeight: 400 }}>doesn&apos;t match</span>
                    )}
                    {confirm && password && confirm === password && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#86efac', fontWeight: 400 }}>✓ match</span>
                    )}
                  </label>
                  <PasswordInput
                    value={confirm} onChange={setConfirm}
                    placeholder="Repeat your password" autoComplete="new-password"
                    show={showConfirm} onToggle={() => setShowConfirm(v => !v)}
                    inputStyle={inputStyle}
                  />
                </div>

                {error && (
                  <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: '#f87171' }}>
                    {error}
                  </div>
                )}
              </div>

              <button type="submit"
                disabled={loading || !name.trim() || !email.trim() || getStrength(password) < 4 || password !== confirm}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent)', color: 'white', fontSize: 13.5, fontWeight: 600, cursor: (loading || !name.trim() || !email.trim() || getStrength(password) < 4 || password !== confirm) ? 'not-allowed' : 'pointer', opacity: (loading || !name.trim() || !email.trim() || getStrength(password) < 4 || password !== confirm) ? 0.5 : 1, transition: 'opacity 150ms' }}
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>

            <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--bld-text-disabled)' }}>
              Already have an account?{' '}
              <Link to={inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : '/login'} style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
                Sign in
              </Link>
            </p>
          </>
        ) : (
          /* ── Verify step ── */
          <div style={{ background: 'var(--bld-bg-panel)', border: '1px solid var(--bld-border)', borderRadius: 14, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <OtpInput onComplete={handleVerify} />

            {verifying && (
              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--bld-text-3)', margin: 0 }}>Verifying…</p>
            )}

            {verifyError && (
              <div style={{ background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '8px 12px', fontSize: 12.5, color: 'var(--bld-error)', textAlign: 'center' }}>
                {verifyError}
              </div>
            )}

            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--bld-text-3)', margin: 0 }}>
              Didn&apos;t receive it?{' '}
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0}
                style={{ background: 'none', border: 'none', color: resendCooldown > 0 ? 'var(--bld-text-disabled)' : 'var(--bld-info)', fontWeight: 600, fontSize: 13, cursor: resendCooldown > 0 ? 'default' : 'pointer', padding: 0 }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </p>

            <p style={{ textAlign: 'center', margin: 0 }}>
              <button
                onClick={() => setStep('form')}
                style={{ background: 'none', border: 'none', color: 'var(--bld-text-3)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                ← Use a different email
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupContent />
    </Suspense>
  );
}
