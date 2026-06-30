'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workspaces as workspacesApi, auth } from '@/lib/platform/api-client';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid #3f3f46', background: '#1a2234',
  color: 'var(--bld-text-1)', fontSize: 13,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 150ms',
};

export default function AcceptInvitationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [pageState, setPageState] = useState<'loading' | 'preview' | 'error' | 'done'>('loading');
  const [invitation, setInvitation] = useState<{
    email: string; role: string; workspaceName: string;
    workspaceId: string; inviterName: string; hasAccount: boolean;
  } | null>(null);
  const [currentUser, setCurrentUser] = useState<{ email: string } | null>(null);
  const [pageError, setPageError] = useState('');

  const [regMode, setRegMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setPageError('Invalid invitation link — no token provided.'); setPageState('error'); return; }
    Promise.all([workspacesApi.previewInvitation(token), auth.me().catch(() => null)])
      .then(([invite, me]) => {
        setInvitation(invite);
        setCurrentUser(me?.user ?? null);
        setLoginEmail(invite.email);
        setRegMode(invite.hasAccount ? 'login' : 'register');
        setPageState('preview');
      })
      .catch((err: Error) => { setPageError(err.message ?? 'Invitation not found or has expired.'); setPageState('error'); });
  }, [token]);

  async function handleAccept() {
    if (!invitation) return;
    try {
      const result = await workspacesApi.acceptInvitation(token);
      setPageState('done');
      setTimeout(() => navigate(`/workspaces/${result.workspaceId}`), 1200);
    } catch (err) { setFormError((err as Error).message ?? 'Failed to accept invitation'); }
  }

  async function handleRegisterAndAccept(e: FormEvent) {
    e.preventDefault();
    if (!invitation) return;
    setFormError('');
    if (password.length < 8) { setFormError('Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    try {
      await auth.register({ name: name.trim(), email: invitation.email, password });
      const result = await workspacesApi.acceptInvitation(token);
      setPageState('done');
      setTimeout(() => navigate(`/workspaces/${result.workspaceId}`), 1200);
    } catch (err) { setFormError((err as Error).message ?? 'Something went wrong.'); }
    finally { setSubmitting(false); }
  }

  async function handleLoginAndAccept(e: FormEvent) {
    e.preventDefault();
    if (!invitation) return;
    setFormError('');
    setSubmitting(true);
    try {
      await auth.login({ email: loginEmail, password: loginPassword });
      const result = await workspacesApi.acceptInvitation(token);
      setPageState('done');
      setTimeout(() => navigate(`/workspaces/${result.workspaceId}`), 1200);
    } catch (err) { setFormError((err as Error).message ?? 'Login failed.'); }
    finally { setSubmitting(false); }
  }

  const container: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070d1a', padding: '24px 16px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' };
  const card: React.CSSProperties = { width: '100%', maxWidth: 440, background: 'var(--bld-bg-panel)', borderRadius: 18, border: '1px solid #27272a', boxShadow: '0 24px 64px rgba(0,0,0,0.55)', overflow: 'hidden' };

  if (pageState === 'loading') return (
    <div style={container}>
      <div style={{ ...card, padding: 40, textAlign: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--bld-text-3)', fontSize: 14, margin: 0 }}>Loading invitation…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );

  if (pageState === 'error') return (
    <div style={container}>
      <div style={{ ...card, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--bld-text-1)', margin: '0 0 8px' }}>Invitation error</h2>
        <p style={{ color: 'var(--bld-text-3)', fontSize: 14, margin: '0 0 24px' }}>{pageError}</p>
        <button onClick={() => navigate('/login')} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #3f3f46', background: 'transparent', color: 'var(--bld-text-3)', fontSize: 13, cursor: 'pointer' }}>Go to login</button>
      </div>
    </div>
  );

  if (pageState === 'done') return (
    <div style={container}>
      <div style={{ ...card, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--bld-text-1)', margin: '0 0 8px' }}>You&apos;re in!</h2>
        <p style={{ color: 'var(--bld-text-3)', fontSize: 14, margin: 0 }}>Redirecting to your workspace…</p>
      </div>
    </div>
  );

  if (pageState === 'preview' && invitation) {
    const emailMismatch = currentUser && currentUser.email.toLowerCase() !== invitation.email.toLowerCase();
    return (
      <div style={container}>
        <div style={card}>
          <div style={{ background: 'linear-gradient(135deg, #4338ca 0%, #6d28d9 100%)', padding: '28px 32px 24px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, color: '#c4b5fd', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Workspace invitation</p>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>You&apos;re invited! 🎉</h1>
          </div>
          <div style={{ padding: '22px 32px 0' }}>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--bld-text-3)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--bld-text-1)' }}>{invitation.inviterName}</strong> invited you to{' '}
              <strong style={{ color: 'var(--bld-text-1)' }}>{invitation.workspaceName}</strong>
              {invitation.role && <> with access to <span style={{ color: '#a5b4fc', fontWeight: 600 }}>{invitation.role}</span></>}.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: '#1a2234', borderRadius: 8, border: '1px solid #27272a', marginBottom: 20 }}>
              <span style={{ fontSize: 14 }}>✉️</span>
              <span style={{ fontSize: 13, color: 'var(--bld-text-disabled)' }}>Invited as</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>{invitation.email}</span>
            </div>
            {emailMismatch && <div style={{ padding: '10px 14px', background: '#1f1507', border: '1px solid #92400e', borderRadius: 8, fontSize: 12, color: '#fbbf24', marginBottom: 16 }}>⚠️ You&apos;re logged in as <strong>{currentUser!.email}</strong>. This invite is for a different account.</div>}
            {currentUser && !emailMismatch && <div style={{ padding: '10px 14px', background: '#071f10', border: '1px solid #14532d', borderRadius: 8, fontSize: 12, color: '#6ee7b7', marginBottom: 20 }}>✓ Signed in as <strong>{currentUser.email}</strong> — ready to accept.</div>}
          </div>

          {currentUser && !emailMismatch && (
            <div style={{ padding: '0 32px 28px', display: 'flex', gap: 8 }}>
              <button onClick={() => navigate('/workspaces')} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #3f3f46', background: 'transparent', color: 'var(--bld-text-disabled)', fontSize: 13, cursor: 'pointer' }}>Decline</button>
              <button onClick={handleAccept} style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent-hover)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Accept invitation</button>
            </div>
          )}

          {currentUser && emailMismatch && (
            <div style={{ borderTop: '1px solid #27272a', padding: '20px 32px 28px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>Sign in as <span style={{ color: '#a5b4fc' }}>{invitation.email}</span> to accept</p>
              <form onSubmit={handleLoginAndAccept} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input type="hidden" value={invitation.email} readOnly />
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Password</label>
                  <input type="password" required autoFocus value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" style={inputStyle} onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent-hover)')} onBlur={e => (e.currentTarget.style.borderColor = '#3f3f46')} />
                </div>
                {formError && <p style={{ margin: 0, fontSize: 12, color: '#f87171', background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '7px 11px' }}>{formError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <button type="button" onClick={() => navigate('/workspaces')} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #3f3f46', background: 'transparent', color: 'var(--bld-text-disabled)', fontSize: 13, cursor: 'pointer' }}>Decline</button>
                  <button type="submit" disabled={submitting || !loginPassword} style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: 'var(--bld-accent-hover)', color: 'white', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Signing in…' : 'Sign in & accept'}</button>
                </div>
              </form>
            </div>
          )}

          {!currentUser && (
            <div style={{ borderTop: '1px solid #27272a', padding: '22px 32px 28px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: 'var(--bld-text-2)' }}>{invitation?.hasAccount ? 'Sign in to accept' : 'Create your account to join'}</p>

              {regMode === 'register' && (
                <form onSubmit={handleRegisterAndAccept} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Email</label><input value={invitation.email} readOnly style={{ ...inputStyle, color: 'var(--bld-text-disabled)', cursor: 'default' }} /></div>
                  <div><label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Your name</label><input type="text" required autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" style={inputStyle} onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent-hover)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')} /></div>
                  <div><label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Create password</label><input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" style={inputStyle} onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent-hover)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')} /></div>
                  {formError && <p style={{ margin: 0, fontSize: 12, color: '#f87171', background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '7px 11px' }}>{formError}</p>}
                  <button type="submit" disabled={submitting} style={{ width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: 'var(--bld-accent-hover)', color: 'white', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, marginTop: 2 }}>{submitting ? 'Creating account…' : 'Create account & join workspace'}</button>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>Already have an account?{' '}<button type="button" onClick={() => { setRegMode('login'); setFormError(''); }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}>Sign in instead</button></p>
                </form>
              )}

              {regMode === 'login' && (
                <form onSubmit={handleLoginAndAccept} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Email</label><input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={inputStyle} onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent-hover)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')} /></div>
                  <div><label style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--bld-text-3)', marginBottom: 5 }}>Password</label><input type="password" required autoFocus value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="Your password" style={inputStyle} onFocus={e => (e.currentTarget.style.borderColor = 'var(--bld-accent-hover)')} onBlur={e => (e.currentTarget.style.borderColor = 'var(--bld-border-subtle)')} /></div>
                  {formError && <p style={{ margin: 0, fontSize: 12, color: '#f87171', background: '#1c0a0a', border: '1px solid #7f1d1d', borderRadius: 7, padding: '7px 11px' }}>{formError}</p>}
                  <button type="submit" disabled={submitting} style={{ width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: 'var(--bld-accent-hover)', color: 'white', fontSize: 13, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, marginTop: 2 }}>{submitting ? 'Signing in…' : 'Sign in & accept invitation'}</button>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--bld-text-disabled)', textAlign: 'center' }}>Don&apos;t have an account?{' '}<button type="button" onClick={() => { setRegMode('register'); setFormError(''); }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}>Create one instead</button></p>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
