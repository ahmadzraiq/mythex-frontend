'use client';

import { useState } from 'react';
import { workspaces as workspacesApi } from '@/lib/platform/api-client';

const PLANS = [
  {
    id: 'FREE' as const,
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For solo builders exploring the platform.',
    color: '#4b5563',
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
    price: '$29',
    period: 'per month',
    description: 'For teams building real products with AI.',
    color: '#6366f1',
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
    price: 'Custom',
    period: 'contact us',
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
] as const;

interface Props {
  workspaceId: string;
  currentPlan: 'FREE' | 'PRO' | 'ENTERPRISE';
  onClose: () => void;
  triggerFeature?: string;
}

export default function PricingModal({ workspaceId, currentPlan, onClose, triggerFeature }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

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
        background: '#111827', borderRadius: 16,
        border: '1px solid #1f2937',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f9fafb' }}>Choose your plan</h2>
            {triggerFeature && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#9ca3af' }}>
                <span style={{ color: '#f87171' }}>✕</span> {triggerFeature} is not available on the Free plan.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid #374151',
              background: 'transparent', color: '#6b7280', cursor: 'pointer',
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
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

            return (
              <div
                key={plan.id}
                style={{
                  borderRadius: 12,
                  border: isHighlight ? `2px solid ${plan.color}` : '1px solid #1f2937',
                  background: isHighlight ? '#0f0a2a' : '#0f172a',
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
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#f9fafb' }}>{plan.price}</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{plan.period}</span>
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{plan.description}</p>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'included' in f && f.included === false ? '#4b5563' : '#d1d5db' }}>
                      {'included' in f ? (
                        <span style={{ fontSize: 12, color: f.included ? '#10b981' : '#374151', flexShrink: 0 }}>
                          {f.included ? '✓' : '✕'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: '#6366f1', flexShrink: 0 }}>•</span>
                      )}
                      <span>{f.label}</span>
                      {'value' in f && f.value && (
                        <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 11 }}>{f.value}</span>
                      )}
                    </div>
                  ))}
                </div>

                {isCurrent ? (
                  <div style={{
                    padding: '9px 14px', borderRadius: 8, border: '1px solid #374151',
                    background: 'transparent', color: '#4b5563',
                    fontSize: 13, fontWeight: 600, textAlign: 'center',
                  }}>
                    Current plan
                  </div>
                ) : plan.id === 'FREE' ? (
                  <div style={{ padding: '9px 14px', borderRadius: 8, fontSize: 13, textAlign: 'center', color: '#4b5563' }}>
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
                      background: isHighlight ? plan.color : '#1f2937',
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
