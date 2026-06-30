'use client';

/**
 * Lazy-loaded Monaco editor wrapper.
 * Configures TypeScript/JavaScript compiler options for the builder's
 * formula editor so IntelliSense works correctly.
 */

import React, { useCallback, lazy, Suspense } from 'react';
import type { EditorProps, OnMount } from '@monaco-editor/react';

const MonacoBase = lazy(() => import('@monaco-editor/react'));

function Monaco(props: EditorProps) {
  return (
    <Suspense fallback={
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', color: '#6b7280', fontSize: 12 }}>
        Loading editor…
      </div>
    }>
      <MonacoBase {...props} />
    </Suspense>
  );
}

let typesInjected = false;

async function injectBuilderTypes(monaco: Parameters<OnMount>[1]) {
  if (typesInjected) return;
  typesInjected = true;

  const ts = monaco.languages.typescript;

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
