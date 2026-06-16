'use client';

/**
 * Reusable JavaScript editor built on `@uiw/react-codemirror` + `@codemirror/lang-javascript`.
 * Used by:
 *   - The formula editor (when the user toggles to "JavaScript" mode).
 *   - The runJavaScript workflow step config panel.
 *
 * Exposes an imperative `insertAtCursor()` so the formula editor's side tabs
 * (Variables / Data / Formulas / Quick) can insert WeWeb-style identifiers
 * (`variables.cartCount`, `collections.products.data`, `context.item.field`)
 * at the current caret position.
 */

import React, { forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';

export interface JavaScriptEditorHandle {
  /** Insert text at the current caret, replacing any selection. Focuses the editor. */
  insertAtCursor(text: string): void;
  /** Programmatically focus the editor. */
  focus(): void;
}

export interface JavaScriptEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Editor min height. Defaults to 120px. */
  minHeight?: number;
  /** Editor max height. Defaults to 360px. */
  maxHeight?: number;
  placeholder?: string;
  /** When provided, used as the data-testid for the wrapper div. */
  testId?: string;
  /** Show line numbers. Defaults to true. */
  lineNumbers?: boolean;
  /** Read-only. */
  readOnly?: boolean;
}

export const JavaScriptEditor = forwardRef<JavaScriptEditorHandle, JavaScriptEditorProps>(function JavaScriptEditor(
  { value, onChange, minHeight = 120, maxHeight = 360, placeholder, testId, lineNumbers = true, readOnly = false },
  ref,
) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const insertAtCursor = useCallback((text: string) => {
    const view = cmRef.current?.view;
    if (!view) {
      onChange(value + text);
      return;
    }
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
    });
    view.focus();
  }, [onChange, value]);

  useImperativeHandle(ref, () => ({
    insertAtCursor,
    focus: () => { cmRef.current?.view?.focus(); },
  }), [insertAtCursor]);

  const extensions = useMemo(() => [javascript({ jsx: false, typescript: false })], []);

  return (
    <div data-testid={testId} style={{ background: 'var(--bld-bg-canvas)', border: '1px solid #1e3050', borderRadius: 6, overflow: 'hidden' }}>
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={oneDark}
        placeholder={placeholder}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers,
          highlightActiveLine: true,
          foldGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          tabSize: 2,
        }}
        style={{
          fontSize: 12,
          minHeight,
          maxHeight,
          fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        }}
      />
    </div>
  );
});
