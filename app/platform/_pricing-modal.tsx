'use client';

import { useState } from 'react';
import { workspaces as workspacesApi } from '@/lib/platform/api-client';

const PLANS = [
  {
    id: 'FREE' as const,
    name: 'Free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    period: 'forever',
    description: 'For solo builders exploring the platform.',
    color: 'var(--bld-text-disabled)',
    highlight: false,
    features: [
      { label: '1 workspace', included: true },
      { label: '1 project', included: true },
      { label: '1 team member', included: true },
      { label: 'AI builder', included: false },
      { label: 'Code export', included: false },
      { label: 'AI tokens', value: 'None' },
      { label: 'Storage', value: '100 MB' },
    ],
  },
  {
    id: 'PRO' as const,
    name: 'Pro',
    monthlyPrice: 29,
    yearlyPrice: 19,
    description: 'For teams building real products with AI.',
    color: 'var(--bld-accent)',
    highlight: true,
    features: [
      { label: 'Unlimited workspaces', included: true },
      { label: 'Unlimited projects', included: true },
      { label: 'Unlimited members', included: true },
      { label: 'AI builder', included: true },
      { label: 'Code export', included: true },
      { label: 'AI tokens', value: '500K / month' },
      { label: 'Storage', value: '10 GB' },
    ],
  },
  {
    id: 'ENTERPRISE' as const,
    name: 'Enterprise',
    monthlyPrice: null,
    yearlyPrice: null,
    description: 'For large teams with advanced needs.',
    color: '#f59e0b',
    highlight: false,
    features: [
      { label: 'Unlimited workspaces', included: true },
      { label: 'Unlimited projects', included: true },
      { label: 'Unlimited members', included: true },
      { label: 'AI builder', included: true },
      { label: 'Code export', included: true },
      { label: 'AI tokens', value: '5M / month' },
      { label: 'Storage', value: '100 GB' },
    ],
  },
];

interface Props {
  workspaceId: string;
  currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  onClose: () => void;
  triggerFeature?: string;
}

export default function PricingModal({ workspaceId, currentPlan, onClose, triggerFeature }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [yearly, setYearly] = useState(true);

  async function handleUpgrade(planId: 'PRO' | 'ENTERPRISE') {
    setLoading(planId);
    setError('');
    try {
      const { url } = await workspacesApi.startCheckout(workspaceId);
      window.location.href = url;
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'GATEWAY_NOT_CONFIGURED') {
        setError('Payment gateway is not yet configured. Please contact support to upgrade.');
      } else {
        setError(e.message ?? 'Something went wrong');
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 840,
        background: 'var(--bld-bg-panel)', borderRadius: 16,
        border: '1px solid #27272a',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--bld-text-1)' }}>Choose your plan</h2>
            {triggerFeature && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--bld-text-3)' }}>
                <span style={{ color: '#f87171' }}>✕</span> {triggerFeature} is not available on the Free plan.
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Billing cycle toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bld-bg-elevated)', borderRadius: 20, padding: '3px 4px', border: '1px solid #27272a' }}>
              <button
                onClick={() => setYearly(false)}
                style={{
                  padding: '4px 12px', borderRadius: 16, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: !yearly ? 'var(--bld-bg-panel)' : 'transparent',
                  color: !yearly ? 'var(--bld-text-1)' : 'var(--bld-text-disabled)',
                  transition: 'all 150ms',
                }}
              >Monthly</button>
              <button
                onClick={() => setYearly(true)}
                style={{
                  padding: '4px 12px', borderRadius: 16, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: yearly ? 'var(--bld-accent)' : 'transparent',
                  color: yearly ? 'white' : 'var(--bld-text-disabled)',
                  transition: 'all 150ms', display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                Yearly
                <span style={{ fontSize: 10, background: '#14532d', color: '#6ee7b7', padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>–34%</span>
              </button>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 8, border: '1px solid #3f3f46',
                background: 'transparent', color: 'var(--bld-text-disabled)', cursor: 'pointer',
                fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div style={{ margin: '16px 32px 0', padding: '10px 14px', background: '#1f1212', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 13, color: '#f87171' }}>
            {error}
          </div>
        )}

        {/* Plan cards */}
        <div style={{ padding: '24px 32px 32px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlan;
            const isHighlight = plan.highlight;
            const price = plan.monthlyPrice === null ? null : (yearly ? plan.yearlyPrice : plan.monthlyPrice);
            const priceStr = price === null ? 'Custom' : price === 0 ? '$0' : `$${price}`;
            const periodStr = price === null ? 'contact us' : price === 0 ? 'forever' : yearly ? '/ mo, billed yearly' : '/ month';

            return (
              <div
                key={plan.id}
                style={{
                  borderRadius: 12,
                  border: isHighlight ? `2px solid ${plan.color}` : '1px solid #27272a',
                  background: isHighlight ? '#0f0a2a' : 'var(--bld-bg-panel)',
                  padding: '20px 20px 20px',
                  display: 'flex', flexDirection: 'column', gap: 0,
                  position: 'relative',
                }}
              >
                {isHighlight && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: plan.color, color: 'white', fontSize: 10, fontWeight: 700,
                    padding: '3px 10px', borderRadius: 20, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    Most Popular
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: plan.color, marginBottom: 4 }}>{plan.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--bld-text-1)' }}>{priceStr}</span>
                    <span style={{ fontSize: 12, color: 'var(--bld-text-disabled)' }}>{periodStr}</span>
                  </div>
                  {yearly && plan.monthlyPrice !== null && plan.monthlyPrice > 0 && (
                    <p style={{ margin: '3px 0 0', fontSize: 11, color: '#6ee7b7' }}>
                      Save ${(plan.monthlyPrice - plan.yearlyPrice!) * 12}/yr vs monthly
                    </p>
                  )}
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--bld-text-disabled)', lineHeight: 1.5 }}>{plan.description}</p>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'included' in f && f.included === false ? 'var(--bld-text-disabled)' : 'var(--bld-text-2)' }}>
                      {'included' in f ? (
                        <span style={{ fontSize: 12, color: f.included ? '#10b981' : 'var(--bld-border-subtle)', flexShrink: 0 }}>
                          {f.included ? '✓' : '✕'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--bld-accent)', flexShrink: 0 }}>•</span>
                      )}
                      <span>{f.label}</span>
                      {'value' in f && f.value && (
                        <span style={{ marginLeft: 'auto', color: 'var(--bld-text-disabled)', fontSize: 11 }}>{f.value}</span>
                      )}
                    </div>
                  ))}
                </div>

                {isCurrent ? (
                  <div style={{
                    padding: '9px 14px', borderRadius: 8, border: '1px solid #3f3f46',
                    background: 'transparent', color: 'var(--bld-text-disabled)',
                    fontSize: 13, fontWeight: 600, textAlign: 'center',
                  }}>
                    Current plan
                  </div>
                ) : plan.id === 'FREE' ? (
                  <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, textAlign: 'center', color: 'var(--bld-text-disabled)' }}>
                    Downgrade
                  </div>
                ) : plan.id === 'ENTERPRISE' ? (
                  <a
                    href="mailto:support@example.com?subject=Enterprise Plan"
                    style={{
                      padding: '9px 14px', borderRadius: 8, border: `1px solid ${plan.color}`,
                      color: plan.color, fontSize: 13, fontWeight: 600, textAlign: 'center',
                      textDecoration: 'none', display: 'block',
                    }}
                  >
                    Contact us
                  </a>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.id as 'PRO')}
                    disabled={loading === plan.id}
                    style={{
                      padding: '9px 14px', borderRadius: 8, border: 'none',
                      background: isHighlight ? plan.color : 'var(--bld-bg-elevated)',
                      color: 'white', fontSize: 13, fontWeight: 600, cursor: loading === plan.id ? 'not-allowed' : 'pointer',
                      opacity: loading === plan.id ? 0.7 : 1, transition: 'opacity 150ms',
                    }}
                  >
                    {loading === plan.id ? 'Redirecting…' : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
