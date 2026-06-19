'use client';

/**
 * Lazy-loaded Monaco editor wrapper.
 * Injects the builder DSL type definitions so IntelliSense works for
 * definePage, Box, vars, etc. in all TypeScript/TSX files.
 * Builder source is fetched from /api/builder-source so this module stays
 * thin and always reflects the live lib/dsl/builder/index.ts.
 */

import dynamic from 'next/dynamic';
import React, { useCallback } from 'react';
import type { EditorProps, OnMount } from '@monaco-editor/react';

const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1e1e1e', color: '#6b7280', fontSize: 12,
    }}>
      Loading editor…
    </div>
  ),
});

let typesInjected = false;

async function injectBuilderTypes(monaco: Parameters<OnMount>[1]) {
  if (typesInjected) return;
  typesInjected = true;

  let builderSource = '';
  try {
    const res = await fetch('/api/builder-source');
    if (res.ok) builderSource = await res.text();
  } catch { /* skip if unavailable */ }

  const builderDts = `
declare module 'builder' {
${builderSource.split('\n').map(l => '  ' + l).join('\n')}
}
`;

  const ts = monaco.languages.typescript;

  ts.typescriptDefaults.addExtraLib(builderDts, 'file:///node_modules/builder/index.d.ts');
  ts.javascriptDefaults.addExtraLib(builderDts, 'file:///node_modules/builder/index.d.ts');

  const shared = {
    noSemanticValidation: true,
    noSyntaxValidation: false,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowSyntheticDefaultImports: true,
  };
  ts.typescriptDefaults.setCompilerOptions(shared);
  ts.javascriptDefaults.setCompilerOptions(shared);
}

export function MonacoEditor(props: EditorProps) {
  const handleMount = useCallback<OnMount>(async (editor, monaco) => {
    await injectBuilderTypes(monaco);
    props.onMount?.(editor, monaco);
  }, [props.onMount]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Monaco {...props} onMount={handleMount} />;
}
