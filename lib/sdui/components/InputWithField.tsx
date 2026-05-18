/**
 * Input wrapper: with children renders real Gluestack Input; without children auto-injects
 * an InputField child so standalone `<Input>` nodes work without explicit children in JSON.
 *
 * Controlled value for explicit-children case:
 *   When JSON declares `Input > InputField` (the standard builder structure), the `value` prop
 *   injected by the renderer onto the `Input` wrapper node is NOT forwarded to the InputField
 *   child — Gluestack's Input component passes its own props (variant, size, className) to
 *   children via context, not arbitrary user props. The InputField child subscribes to
 *   `{parentInputId}-value` in the global variable store directly via useExternalNodeValueSync
 *   (see form-field-tracker.ts), so the controlled value reaches it without any prop threading.
 *
 * Controlled value for no-children case:
 *   When no children are present, InputWithField renders its own InputField and passes
 *   `value` directly — standard controlled component pattern.
 *
 * readOnly handling: React Native TextInput uses `editable={false}` for read-only.
 * On web, NativeWind maps editable={false} → readonly DOM attribute.
 *
 * format prop:
 *   A positional mask string applied on every keystroke.
 *   Tokens: # = digit, A = letter, * = alphanumeric; any other char is a literal
 *   that is auto-inserted and skipped when the user types.
 *   Example: "####-##-##" produces "2026-04-29"; "(###) ###-####" produces "(415) 555-1234".
 *   The stored/emitted value includes the literal separators.
 */

'use client';

import React from 'react';
import { Input, InputField } from '@/components/ui/input';

/** Positional mask: # = digit, A = letter, * = alphanumeric; anything else is a literal. */
function applyMask(raw: string, format: string): string {
  const TOKEN: Record<string, RegExp> = { '#': /[0-9]/, 'A': /[a-zA-Z]/, '*': /[a-zA-Z0-9]/ };
  let ri = 0;
  let out = '';
  for (let fi = 0; fi < format.length && ri < raw.length; fi++) {
    const fc = format[fi];
    const pat = TOKEN[fc];
    if (pat) {
      // Advance past raw chars that don't match the expected token type
      while (ri < raw.length && !pat.test(raw[ri])) ri++;
      if (ri < raw.length) out += raw[ri++];
    } else {
      // Literal character: auto-insert it, and skip it in the raw input if present
      out += fc;
      if (raw[ri] === fc) ri++;
    }
  }
  return out;
}

/**
 * Strip literal separators from a (partially or fully) masked string so we get back only
 * the user-typed characters.  Uses separate pointers for the masked string and the format:
 * - At a token position: always collect the masked character.
 * - At a literal position: skip the masked character only when it equals the expected literal
 *   (it was auto-inserted); otherwise just advance the format pointer so the next token
 *   position can absorb the character.
 * This correctly handles cases like "19981" (user typed '1' into an input showing "1998")
 * where the browser value has the new digit at what would be the literal '-' position.
 */
function stripLiterals(masked: string, format: string): string {
  const TOKEN: Record<string, RegExp> = { '#': /[0-9]/, 'A': /[a-zA-Z]/, '*': /[a-zA-Z0-9]/ };
  let out = '';
  let mi = 0;
  for (let fi = 0; fi < format.length && mi < masked.length; fi++) {
    const fc = format[fi];
    const mc = masked[mi];
    if (TOKEN[fc]) {
      out += mc;
      mi++;
    } else {
      // Literal: only consume the masked char when it matches the expected literal
      if (mc === fc) mi++;
      // If it doesn't match, advance fi only — the char will be picked up by the next token
    }
  }
  return out;
}

type InputWithFieldProps = {
  placeholder?: string;
  value?: string;
  readOnly?: boolean;
  format?: string;
  onChange?: (e: unknown) => void;
  onChangeText?: (text: string) => void;
  children?: React.ReactNode;
  [k: string]: unknown;
};

export const InputWithField = React.forwardRef<
  React.ComponentRef<typeof Input>,
  InputWithFieldProps
>(function InputWithField(props, ref) {
  const { placeholder, value, defaultValue, readOnly, format, onChange, onChangeText, children, ...rest } = props as InputWithFieldProps & { defaultValue?: string };

  if (children) {
    // With children: pass everything through except format (not a native prop)
    return (
      <Input
        ref={ref}
        {...(rest as React.ComponentProps<typeof Input>)}
        {...(readOnly ? { readOnly: true } : {})}
      >
        {children as React.ReactNode}
      </Input>
    );
  }

  const { className, placeholderTextColor = '#737373', ...restWithoutClass } = rest as Record<string, unknown> & { className?: string; placeholderTextColor?: string };

  const hasExternalControl = value !== undefined;
  const [localValue, setLocalValue] = React.useState('');
  // Tracks the last value we sent to the store so the echo-back from the store
  // doesn't overwrite what the user just typed.
  const lastSentRef = React.useRef<string>('');

  // Sync an externally-driven value change (e.g. date-picker modal selects a date)
  // into localValue — but only when it differs from what we last sent.
  React.useEffect(() => {
    if (format && value !== undefined && value !== lastSentRef.current) {
      setLocalValue(applyMask(stripLiterals(value as string, format), format));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, format]);

  function extractText(e: unknown): string {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      if ('nativeEvent' in (e as object)) return ((e as { nativeEvent: { text: string } }).nativeEvent?.text) ?? '';
      if ('target' in (e as object)) return ((e as { target: { value: string } }).target?.value) ?? '';
    }
    return String(e ?? '');
  }

  const handleChange = React.useMemo(() => {
    if (!format) return onChange ?? onChangeText;
    const storeHandler = onChange ?? onChangeText;
    return (e: unknown) => {
      const masked = applyMask(stripLiterals(extractText(e), format), format);
      // Update display instantly — no round-trip through the store.
      setLocalValue(masked);
      lastSentRef.current = masked;
      if (storeHandler) (storeHandler as (v: string) => void)(masked);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, onChange, onChangeText]);

  const displayValue = React.useMemo(() => {
    // No mask + no external binding → uncontrolled; let InputField manage its own state.
    if (!format && !hasExternalControl) return undefined;
    // Masked inputs always use localValue for instant display (store update is async side-effect).
    if (format) return localValue;
    return value;
  }, [format, value, localValue, hasExternalControl]);

  return (
    <Input ref={ref} {...(restWithoutClass as React.ComponentProps<typeof Input>)} className={className}>
      <InputField
        placeholder={placeholder as string}
        placeholderTextColor={placeholderTextColor}
        value={displayValue as string | undefined}
        defaultValue={displayValue === undefined ? defaultValue : undefined}
        editable={readOnly ? false : undefined}
        onChange={handleChange as React.ComponentProps<typeof InputField>['onChange']}
        onChangeText={handleChange as React.ComponentProps<typeof InputField>['onChangeText']}
      />
    </Input>
  );
});
