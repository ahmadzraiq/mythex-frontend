/**
 * static-files.ts — Generate static project configuration files.
 */

import type { CodegenCtx, EmittedFile } from '../types';
import themeJson from '@/config/theme.json';

// ── Font registry ─────────────────────────────────────────────────────────────
// Maps CSS variable name (without --) to next/font/google import info.
// Each entry mirrors the font loading in the main app/layout.tsx.

interface FontEntry {
  importName: string;
  weights?: string[];
}

const FONT_REGISTRY: Record<string, FontEntry> = {
  'font-geist-sans':        { importName: 'Geist' },
  'font-geist-mono':        { importName: 'Geist_Mono' },
  'font-inter':             { importName: 'Inter' },
  'font-plus-jakarta-sans': { importName: 'Plus_Jakarta_Sans' },
  'font-roboto':            { importName: 'Roboto',            weights: ['400','500','600','700'] },
  'font-roboto-mono':       { importName: 'Roboto_Mono' },
  'font-space-grotesk':     { importName: 'Space_Grotesk' },
  'font-rajdhani':          { importName: 'Rajdhani',          weights: ['400','500','600','700'] },
  'font-oxanium':           { importName: 'Oxanium',           weights: ['400','500','600','700'] },
  'font-rubik':             { importName: 'Rubik' },
  'font-exo-2':             { importName: 'Exo_2' },
  'font-ibm-plex-sans':     { importName: 'IBM_Plex_Sans',     weights: ['400','500','600','700'] },
  'font-noto-sans':         { importName: 'Noto_Sans' },
  'font-lato':              { importName: 'Lato',              weights: ['400','700'] },
  'font-poppins':           { importName: 'Poppins',           weights: ['400','600','700'] },
  'font-montserrat':        { importName: 'Montserrat',        weights: ['400','600','700'] },
  'font-playfair-display':  { importName: 'Playfair_Display',  weights: ['400','600','700'] },
  'font-dm-sans':           { importName: 'DM_Sans',           weights: ['400','600','700'] },
  'font-nunito':            { importName: 'Nunito',            weights: ['400','600','700'] },
  'font-source-code-pro':   { importName: 'Source_Code_Pro' },
  'font-space-mono':        { importName: 'Space_Mono',        weights: ['400','700'] },
};

/**
 * Extract the CSS variable key from a font reference.
 * Handles both "var(--font-space-grotesk)" and "Space Grotesk" (name string) formats.
 * Returns the CSS var key like "font-space-grotesk", or null if not recognised.
 */
function fontRefToCssVarKey(ref: string): string | null {
  if (!ref) return null;
  // "var(--font-space-grotesk)" → "font-space-grotesk"
  const varMatch = ref.match(/var\s*\(\s*--([a-z0-9-]+)\s*\)/);
  if (varMatch) return varMatch[1];
  // "Space Grotesk" → "font-space-grotesk"
  if (!ref.startsWith('var(')) {
    return 'font-' + ref.trim().toLowerCase().replace(/\s+/g, '-');
  }
  return null;
}

/** Read body/heading/mono font CSS-var keys from theme.json + store themeOverrides. */
export function resolveProjectFonts(ctx: CodegenCtx): {
  bodyVarKey: string | null;
  headingVarKey: string | null;
  monoVarKey: string | null;
} {
  const store = ctx.store as Record<string, unknown>;
  const themeOverrides = (store.themeOverrides ?? {}) as Record<string, string>;
  const tj = themeJson as Record<string, unknown>;
  const themeFonts = (tj.fonts ?? {}) as Record<string, string>;

  // themeOverrides takes precedence over theme.json defaults
  const bodyRef    = themeOverrides['font-body']    || themeFonts.body    || '';
  const headingRef = themeOverrides['font-heading'] || themeFonts.heading || '';
  const monoRef    = themeOverrides['font-mono']    || themeFonts.mono    || '';

  return {
    bodyVarKey:    fontRefToCssVarKey(bodyRef),
    headingVarKey: fontRefToCssVarKey(headingRef),
    monoVarKey:    fontRefToCssVarKey(monoRef),
  };
}

export function emitPackageJson(ctx: CodegenCtx, appName: string): EmittedFile {
  const { flags } = ctx;

  const deps: Record<string, string> = {
    'next': '^15.3.0',
    'react': '^19.0.0',
    'react-dom': '^19.0.0',
    'zustand': '^5.0.0',
    // zustand/traditional (used for custom equality fn on pages with extracted input sub-components)
    // requires this peer dep — useSyncExternalStoreWithSelector is not built into React 18/19
    'use-sync-external-store': '^1.4.0',
    'tailwindcss': '^3.4.17',
    '@iconify/react': '^5.0.0',
    'clsx': '^2.1.0',
    'tailwind-merge': '^2.5.0',
    'next-themes': '^0.4.0',
  };

  if (flags.hasForms) {
    deps['react-hook-form'] = '^7.53.0';
    deps['zod'] = '^3.23.0';
    deps['@hookform/resolvers'] = '^3.9.0';
  }
  if (flags.hasPopovers) deps['@radix-ui/react-popover'] = '^1.1.0';
  if (flags.hasAnimations) deps['framer-motion'] = '^12.0.0';
  if (flags.hasCharts) deps['recharts'] = '^2.15.0';
  if (flags.hasMarkdown) {
    deps['react-markdown'] = '^9.0.0';
    deps['remark-gfm'] = '^4.0.0';
  }
  if (flags.hasLottie) deps['lottie-react'] = '^2.4.0';
  if (flags.hasQR) deps['qrcode.react'] = '^4.0.0';
  if (flags.hasToast) deps['sonner'] = '^1.5.0';
  if (flags.hasGoogleMap) deps['@vis.gl/react-google-maps'] = '^1.0.0';

  const devDeps: Record<string, string> = {
    '@types/node': '^22.0.0',
    '@types/react': '^19.0.0',
    '@types/react-dom': '^19.0.0',
    '@types/use-sync-external-store': '^0.0.6',
    'typescript': '^5.6.0',
    'autoprefixer': '^10.4.20',
    'postcss': '^8.4.47',
  };

  const pkg = {
    name: appName.toLowerCase().replace(/\s+/g, '-'),
    version: '1.0.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
    },
    dependencies: deps,
    devDependencies: devDeps,
  };

  return {
    path: 'package.json',
    content: JSON.stringify(pkg, null, 2),
  };
}

export function emitTsConfig(): EmittedFile {
  const config = {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: false,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: {
        '@/*': ['./*'],
      },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  };

  return { path: 'tsconfig.json', content: JSON.stringify(config, null, 2) };
}

export function emitNextConfig(ctx: CodegenCtx): EmittedFile {
  const lines: string[] = [];
  lines.push(`import type { NextConfig } from 'next';`);
  lines.push('');
  lines.push(`const nextConfig: NextConfig = {`);
  lines.push(`  typescript: { ignoreBuildErrors: true },`);
  lines.push(`  eslint: { ignoreDuringBuilds: true },`);
  lines.push(`  images: {`);
  lines.push(`    remotePatterns: [`);
  lines.push(`      { protocol: 'https', hostname: '**' },`);
  lines.push(`      { protocol: 'http', hostname: '**' },`);
  lines.push(`    ],`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default nextConfig;`);

  return { path: 'next.config.ts', content: lines.join('\n') };
}

export function emitTailwindConfig(ctx: CodegenCtx): EmittedFile {
  const { customColors } = ctx;
  const { bodyVarKey, headingVarKey, monoVarKey } = resolveProjectFonts(ctx);

  const customColorTokens: Record<string, string> = {};
  for (const color of customColors) {
    customColorTokens[color.name] = `rgb(var(--${color.name}) / <alpha-value>)`;
  }

  const lines: string[] = [];
  lines.push(`import type { Config } from 'tailwindcss';`);
  lines.push('');
  lines.push(`const config: Config = {`);
  lines.push(`  darkMode: 'class',`);
  lines.push(`  content: [`);
  lines.push(`    './app/**/*.{js,ts,jsx,tsx,mdx}',`);
  lines.push(`    './components/**/*.{js,ts,jsx,tsx,mdx}',`);
  lines.push(`    './lib/**/*.{js,ts,jsx,tsx,mdx}',`);
  lines.push(`  ],`);
  lines.push(`  theme: {`);
  lines.push(`    extend: {`);

  if (Object.keys(customColorTokens).length > 0) {
    lines.push(`      colors: ${JSON.stringify(customColorTokens, null, 6).replace(/^/gm, '      ')},`);
  }

  // fontFamily — mirrors the builder's tailwind.config.js so `font-body`/`font-heading` classes work.
  // `mono: undefined` matches the builder which removes the default .font-mono CSS rule so that
  // elements using font-mono inherit the project body font rather than the browser's system monospace.
  // If the project explicitly configures a mono font, it is applied instead.
  const bodyFontFamily    = bodyVarKey    ? `var(--${bodyVarKey})`    : 'system-ui';
  const headingFontFamily = headingVarKey ? `var(--${headingVarKey})` : 'system-ui';
  lines.push(`      fontFamily: {`);
  lines.push(`        body:    ['${bodyFontFamily}',    'system-ui', 'sans-serif'],`);
  lines.push(`        heading: ['${headingFontFamily}', 'system-ui', 'sans-serif'],`);
  lines.push(`        sans:    ['${bodyFontFamily}',    'system-ui', 'sans-serif'],`);
  if (monoVarKey) {
    // Project has an explicit mono font — use it for font-mono class
    lines.push(`        mono:    ['var(--${monoVarKey})',    'ui-monospace', 'monospace'],`);
  } else {
    // No mono font configured: remove the default .font-mono CSS rule to match builder behaviour
    // where font-mono elements inherit the body font (the builder sets mono: undefined in its config)
    lines.push(`        mono:    undefined,`);
  }
  lines.push(`      },`);

  // Named animation utilities
  lines.push(`      animation: {`);
  lines.push(`        'glow-pulse': 'glowPulse 2s ease-in-out infinite',`);
  lines.push(`        'float': 'float 3s ease-in-out infinite',`);
  lines.push(`        'gradient-drift': 'gradientDrift 6s ease infinite',`);
  lines.push(`        'shake': 'shake 0.5s ease-in-out',`);
  lines.push(`        'slide-up': 'slideUp 0.3s ease-out',`);
  lines.push(`        'slide-down': 'slideDown 0.3s ease-out',`);
  lines.push(`        'zoom-in': 'zoomIn 0.2s ease-out',`);
  lines.push(`      },`);
  lines.push(`    },`);
  lines.push(`  },`);
  lines.push(`  plugins: [],`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default config;`);

  return { path: 'tailwind.config.ts', content: lines.join('\n') };
}

export function emitPostcssConfig(): EmittedFile {
  return {
    path: 'postcss.config.js',
    content: `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
  };
}

export function emitRootLayout(ctx: CodegenCtx, hasLayoutShell = false): EmittedFile {
  const { bodyVarKey, headingVarKey, monoVarKey: _monoVarKey } = resolveProjectFonts(ctx);
  void _monoVarKey;

  // Collect unique CSS-var keys that need to be loaded as fonts
  const fontVarKeys = Array.from(new Set([bodyVarKey, headingVarKey].filter(Boolean))) as string[];

  // Build font import + instantiation lines
  const fontImports: string[] = [];
  const fontInits: string[]   = [];
  const fontVarNames: string[] = []; // variable names for className

  for (const varKey of fontVarKeys) {
    const entry = FONT_REGISTRY[varKey];
    if (!entry) continue; // unknown font — skip, CSS var will just be empty
    fontImports.push(entry.importName);
    const instanceName = varKey.replace(/^font-/, '').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const configEntries: string[] = [`  variable: '--${varKey}'`, `  subsets: ['latin']`];
    if (entry.weights) {
      configEntries.push(`  weight: [${entry.weights.map(w => `'${w}'`).join(', ')}]`);
    }
    fontInits.push(`const _${instanceName} = ${entry.importName}({\n${configEntries.join(',\n')},\n});`);
    fontVarNames.push(`_${instanceName}.variable`);
  }

  const lines: string[] = [];

  if (fontImports.length > 0) {
    lines.push(`import { ${fontImports.join(', ')} } from 'next/font/google';`);
  }
  lines.push(`import type { Metadata } from 'next';`);
  lines.push(`import { ThemeProvider } from 'next-themes';`);
  lines.push(`import './globals.css';`);
  if (hasLayoutShell) {
    lines.push(`import { LayoutShell } from './_layout-shell';`);
  }
  lines.push('');

  for (const init of fontInits) {
    lines.push(init);
    lines.push('');
  }

  const appName = (ctx.store as unknown as Record<string, unknown>).projectAppName as string || 'My App';
  lines.push(`export const metadata: Metadata = {`);
  lines.push(`  title: '${appName}',`);
  lines.push(`  description: '${((ctx.store as unknown as Record<string, unknown>).projectDescription as string) || ''}',`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default function RootLayout({ children }: { children: React.ReactNode }) {`);
  lines.push(`  return (`);
  lines.push(`    <html lang="en" suppressHydrationWarning>`);

  const bodyClassName = fontVarNames.length > 0
    ? ` className={\`\${${fontVarNames.join('} ${')}}\`}`
    : '';
  lines.push(`      <body${bodyClassName}>`);
  lines.push(`        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>`);
  if (hasLayoutShell) {
    lines.push(`          <LayoutShell>{children}</LayoutShell>`);
  } else {
    lines.push(`          {children}`);
  }
  lines.push(`        </ThemeProvider>`);
  lines.push(`      </body>`);
  lines.push(`    </html>`);
  lines.push(`  );`);
  lines.push(`}`);

  return { path: 'app/layout.tsx', content: lines.join('\n') };
}

export function emitGitignore(): EmittedFile {
  return {
    path: '.gitignore',
    content: `# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# env
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# typescript
*.tsbuildinfo
next-env.d.ts
`,
  };
}

export function emitReadme(ctx: CodegenCtx, appName: string): EmittedFile {
  const { flags } = ctx;
  const lines: string[] = [];

  lines.push(`# ${appName}`);
  lines.push('');
  lines.push('Generated by the visual builder. This is a standalone Next.js + Tailwind app.');
  lines.push('');
  lines.push('## Getting Started');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Install dependencies');
  lines.push('npm install');
  lines.push('');
  lines.push('# 2. Configure environment variables');
  lines.push('cp .env.example .env.local');
  lines.push('# Edit .env.local and fill in your values');
  lines.push('');
  lines.push('# 3. Run development server');
  lines.push('npm run dev');
  lines.push('```');
  lines.push('');
  lines.push('## Stack');
  lines.push('');
  lines.push('- **Next.js 15** — App Router');
  lines.push('- **React 19**');
  lines.push('- **Tailwind CSS** — Utility-first styling');
  lines.push('- **Zustand** — Global state (`lib/store.ts`)');
  if (flags.hasForms) lines.push('- **React Hook Form + Zod** — Form handling and validation');
  if (flags.hasPopovers) lines.push('- **Radix UI Popover** — Accessible popover components');
  if (flags.hasAnimations) lines.push('- **Framer Motion** — Animations');
  if (flags.hasFetch || flags.hasGraphQL) lines.push('- **lib/api.ts** — Data fetching functions');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- This is a snapshot export. Re-exporting from the builder will overwrite these files.');
  lines.push('- All state is managed in `lib/store.ts`. Workflows live in `lib/workflows.ts`.');
  lines.push('- Icons use [@iconify/react](https://iconify.design).');

  return { path: 'README.md', content: lines.join('\n') };
}
