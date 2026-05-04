/**
 * animations.test.ts — Tests for animation config → Framer Motion props.
 */

import { describe, it, expect } from 'vitest';
import { animationToMotionProps, motionTag, NAMED_KEYFRAMES } from '../animations';

describe('animationToMotionProps', () => {
  it('generates initial/animate for enter animation', () => {
    const used = new Set<string>();
    const props = animationToMotionProps({ enter: { opacity: { from: 0, to: 1 } } }, used);
    expect(props.initial).toBeDefined();
    expect(props.animate).toBeDefined();
    expect(props.initial).toContain('"opacity"');
    expect(props.animate).toContain('"opacity"');
  });

  it('generates exit for exit animation', () => {
    const used = new Set<string>();
    const props = animationToMotionProps({ exit: { opacity: { from: 1, to: 0 } } }, used);
    expect(props.exit).toBeDefined();
  });

  it('generates whileHover for hover animation', () => {
    const used = new Set<string>();
    const props = animationToMotionProps({ hover: { scale: { from: 1, to: 1.05 } } }, used);
    expect(props.whileHover).toBeDefined();
  });

  it('generates whileTap for press animation', () => {
    const used = new Set<string>();
    const props = animationToMotionProps({ press: { scale: { from: 1, to: 0.95 } } }, used);
    expect(props.whileTap).toBeDefined();
  });

  it('adds named loop to usedAnimations set', () => {
    const used = new Set<string>();
    animationToMotionProps({ loop: { name: 'glowPulse' } }, used);
    expect(used.has('glowPulse')).toBe(true);
  });

  it('emits data-css-animation for named loops', () => {
    const used = new Set<string>();
    const props = animationToMotionProps({ loop: { name: 'glowPulse' } }, used);
    expect(props['data-css-animation']).toBeDefined();
  });

  it('returns empty object for null animation', () => {
    const used = new Set<string>();
    const props = animationToMotionProps(null as never, used);
    expect(Object.keys(props)).toHaveLength(0);
  });
});

describe('motionTag', () => {
  it('prepends motion. to html tags', () => {
    expect(motionTag('div')).toBe('motion.div');
    expect(motionTag('span')).toBe('motion.span');
    expect(motionTag('button')).toBe('motion.button');
  });
});

describe('NAMED_KEYFRAMES', () => {
  it('has entries for standard named animations', () => {
    expect(NAMED_KEYFRAMES.glowPulse).toBeDefined();
    expect(NAMED_KEYFRAMES.ripple).toBeDefined();
    expect(NAMED_KEYFRAMES.gradientDrift).toBeDefined();
    expect(NAMED_KEYFRAMES.fadeIn).toBeDefined();
    expect(NAMED_KEYFRAMES.slideUp).toBeDefined();
    expect(NAMED_KEYFRAMES.zoomIn).toBeDefined();
  });

  it('each entry contains valid @keyframes syntax', () => {
    for (const [name, kf] of Object.entries(NAMED_KEYFRAMES)) {
      expect(kf).toContain('@keyframes');
      expect(kf).toContain(name);
    }
  });
});
