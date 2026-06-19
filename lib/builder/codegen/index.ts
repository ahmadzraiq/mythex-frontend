/**
 * lib/builder/codegen/index.ts
 *
 * Entry point for the React code export pipeline.
 *
 *   codegenProject(builderState)
 *     → EmittedFile[]   (in-memory file tree)
 *
 * Consumers (ExportModal) then:
 *   1. Run formatAllFiles() for prettier pass
 *   2. Call createZip() to bundle into a .zip
 *   3. Call downloadBlob() to trigger the browser download
 */

import type { BuilderStore } from '@/app/dev/builder/_store-types';
import type { EmittedFile } from './types';
import { buildCodegenCtx } from './plan';
import { emitPages, emitLayoutShell } from './routing';
import { emitWorkflowFiles } from './workflows';
import { emitStoreTs } from './store';
import { emitApiTs, emitEnvExample, emitProxyRoutes } from './datasources';
import { emitGlobalsCss } from './theme';
import { emitAuthFiles } from './auth';
import { emitAssetsGitkeep } from './assets';
import {
  emitPackageJson,
  emitTsConfig,
  emitNextConfig,
  emitTailwindConfig,
  emitPostcssConfig,
  emitRootLayout,
  emitGitignore,
  emitReadme,
  emitThemeTs,
  emitThemeSyncComponent,
  emitAuthSyncComponent,
  emitActionCtxTs,
} from './files/static-files';
import { emitUtilsTs } from './files/utils-template';

export interface CodegenOptions {
  appName?: string;
}

/**
 * Main codegen entry point.
 *
 * Throws if a formula cannot be rewritten or an unknown action type
 * is encountered — there are no silent fallbacks.
 */
export function codegenProject(
  store: BuilderStore,
  options: CodegenOptions = {},
): EmittedFile[] {
  const appName = options.appName
    ?? (store as unknown as Record<string, unknown>).projectAppName as string
    ?? 'my-app';

  const ctx = buildCodegenCtx(store);
  const files: EmittedFile[] = [];
  const usedAnimations = new Set<string>();

  // ── Static project configuration files ──────────────────────────────────────
  files.push(emitPackageJson(ctx, appName));
  files.push(emitTsConfig());
  files.push(emitNextConfig(ctx));
  files.push(emitTailwindConfig(ctx));
  files.push(emitPostcssConfig());
  files.push(emitGitignore());

  // ── App shell ────────────────────────────────────────────────────────────────
  // Layout shell is emitted first (before pages) so usedAnimations picks up canvas node animations.
  const layoutShellFile = emitLayoutShell(ctx, usedAnimations);
  files.push(emitRootLayout(ctx, !!layoutShellFile));
  if (layoutShellFile) files.push(layoutShellFile);

  // ── Pages (must run before globals.css since it collects usedAnimations) ─────
  const pageFiles = emitPages(ctx, usedAnimations);
  files.push(...pageFiles);

  // ── globals.css (after pages so usedAnimations is populated) ─────────────────
  files.push({
    path: 'app/globals.css',
    content: emitGlobalsCss(ctx, usedAnimations),
  });

  // ── Library files ────────────────────────────────────────────────────────────
  files.push(emitStoreTs(ctx));
  files.push(emitUtilsTs());
  if (ctx.flags.hasThemeActions) {
    files.push(emitThemeTs());
    files.push(emitThemeSyncComponent());
  }
  if (ctx.flags.hasAuth) {
    const unauthRedirect = (ctx.store.authConfig as Record<string, string> | undefined)?.unauthenticatedRedirect ?? '/sign-in';
    files.push(emitAuthSyncComponent(unauthRedirect));
  }

  if (ctx.flags.hasFetch || ctx.flags.hasGraphQL || (ctx.store.pageDataSources ?? []).length > 0) {
    files.push(emitApiTs(ctx));
    files.push(...emitProxyRoutes(ctx));
  }

  // ── Action functions (split into lib/actions/<domain>.ts files) ──────────────
  const allWorkflows = store.workflows ?? {};
  if (Object.keys(allWorkflows).length > 0) {
    // Shared context factory (lib/action-ctx.ts) must come before action files
    files.push(emitActionCtxTs());
    files.push(...emitWorkflowFiles(ctx));
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────
  files.push(...emitAuthFiles(ctx));

  // ── Environment variables ─────────────────────────────────────────────────────
  files.push(emitEnvExample(ctx));

  // ── Public assets placeholder ──────────────────────────────────────────────────
  files.push(emitAssetsGitkeep());

  // ── README ────────────────────────────────────────────────────────────────────
  files.push(emitReadme(ctx, appName));

  // ── Primitive component helpers (only when actually used) ─────────────────────
  if (ctx.flags.hasCharts) files.push(emitPrimitiveComponents(ctx));
  if (ctx.flags.hasLottie) files.push(emitLottieWrapper());

  return files;
}

import type { CodegenCtx } from './types';

/** Emit components/primitives/lottie-player.tsx — URL-based Lottie wrapper */
function emitLottieWrapper(): EmittedFile {
  return {
    path: 'components/primitives/lottie-player.tsx',
    content: `'use client';
import Lottie from 'lottie-react';
import { useState, useEffect } from 'react';

interface LottiePlayerProps {
  path?: string;
  src?: string;
  autoplay?: boolean;
  loop?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function LottiePlayer({ path, src, autoplay = true, loop = true, width, height, className, style }: LottiePlayerProps) {
  const url = path ?? src;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!url) return;
    fetch(url).then(r => r.json()).then(setData).catch(console.error);
  }, [url]);

  return (
    <div className={className} style={{ width, height, ...style }}>
      {data && <Lottie animationData={data} autoplay={autoplay} loop={loop} style={{ width: '100%', height: '100%' }} />}
    </div>
  );
}
`,
  };
}

/** Emit components/primitives/dynamic-chart.tsx and google-map.tsx */
function emitPrimitiveComponents(_ctx: CodegenCtx): EmittedFile {
  // DynamicChart — thin recharts wrapper
  return {
    path: 'components/primitives/dynamic-chart.tsx',
    content: `'use client';
import { ResponsiveContainer, LineChart, BarChart, PieChart, AreaChart, Line, Bar, Pie, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Cell } from 'recharts';

interface DynamicChartProps {
  type?: 'line' | 'bar' | 'pie' | 'area';
  data?: Record<string, unknown>[];
  dataKey?: string;
  xKey?: string;
  className?: string;
  height?: number;
}

export function DynamicChart({ type = 'line', data = [], dataKey = 'value', xKey = 'name', className, height = 300 }: DynamicChartProps) {
  const ChartComponent = type === 'bar' ? BarChart : type === 'area' ? AreaChart : type === 'pie' ? PieChart : LineChart;
  const DataComponent = type === 'bar' ? Bar : type === 'area' ? Area : type === 'pie' ? Pie : Line;

  return (
    <ResponsiveContainer width="100%" height={height} className={className}>
      <ChartComponent data={type === 'pie' ? undefined : data}>
        {type !== 'pie' && <CartesianGrid strokeDasharray="3 3" />}
        {type !== 'pie' && <XAxis dataKey={xKey} />}
        {type !== 'pie' && <YAxis />}
        <Tooltip />
        <Legend />
        {type === 'pie'
          ? <Pie data={data} dataKey={dataKey} nameKey={xKey}>{data.map((_, i) => <Cell key={i} />)}</Pie>
          : <DataComponent type="monotone" dataKey={dataKey} />
        }
      </ChartComponent>
    </ResponsiveContainer>
  );
}
`,
  };
}

// Re-export for convenience
export { formatAllFiles } from './prettier';
export { createZip, downloadBlob } from './zip';
