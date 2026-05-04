/**
 * primitives.test.ts — Verify the primitive mapping table.
 */

import { describe, it, expect } from 'vitest';
import { getPrimitive, resolveTextTag } from '../primitives';

describe('getPrimitive', () => {
  it('maps Box to div', () => {
    expect(getPrimitive('Box').tag).toBe('div');
  });

  it('maps Text to span', () => {
    expect(getPrimitive('Text').tag).toBe('span');
  });

  it('maps Icon to Icon with @iconify/react import', () => {
    const p = getPrimitive('Icon');
    expect(p.tag).toBe('Icon');
    expect(p.importFrom).toBe('@iconify/react');
  });

  it('maps Image to Image with next/image import', () => {
    const p = getPrimitive('Image');
    expect(p.tag).toBe('Image');
    expect(p.importFrom).toBe('next/image');
    expect(p.isDefaultImport).toBe(true);
  });

  it('maps Input to input with selfClose', () => {
    const p = getPrimitive('Input');
    expect(p.tag).toBe('input');
    expect(p.selfClose).toBe(true);
  });

  it('maps FormContainer to form', () => {
    expect(getPrimitive('FormContainer').tag).toBe('form');
  });

  it('maps Iframe to iframe', () => {
    expect(getPrimitive('Iframe').tag).toBe('iframe');
  });

  it('maps Chart to DynamicChart with local import', () => {
    const p = getPrimitive('Chart');
    expect(p.tag).toBe('DynamicChart');
    expect(p.importFrom).toContain('dynamic-chart');
  });

  it('maps QRCodeWidget to QRCodeSVG', () => {
    const p = getPrimitive('QRCodeWidget');
    expect(p.tag).toBe('QRCodeSVG');
    expect(p.importFrom).toBe('qrcode.react');
  });

  it('maps LottiePlayer to LottiePlayer wrapper component', () => {
    const p = getPrimitive('LottiePlayer');
    expect(p.tag).toBe('LottiePlayer');
    expect(p.importFrom).toContain('lottie-player');
  });

  it('returns div for unknown types', () => {
    expect(getPrimitive('UnknownXYZ').tag).toBe('div');
  });
});

describe('resolveTextTag', () => {
  it('returns h1 for role=heading', () => {
    expect(resolveTextTag({ role: 'heading' })).toBe('h1');
    expect(resolveTextTag({ role: 'h1' })).toBe('h1');
  });

  it('returns h2/h3 for role=h2/h3', () => {
    expect(resolveTextTag({ role: 'h2' })).toBe('h2');
    expect(resolveTextTag({ role: 'h3' })).toBe('h3');
  });

  it('returns label for role=label', () => {
    expect(resolveTextTag({ role: 'label' })).toBe('label');
  });

  it('respects the `as` prop override', () => {
    expect(resolveTextTag({ as: 'div' })).toBe('div');
  });

  it('returns span by default', () => {
    expect(resolveTextTag({})).toBe('span');
  });
});
