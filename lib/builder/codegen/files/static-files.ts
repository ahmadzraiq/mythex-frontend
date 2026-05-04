/**
 * static-files.ts — Generate static project configuration files.
 */

import type { CodegenCtx, EmittedFile } from '../types';

export function emitPackageJson(ctx: CodegenCtx, appName: string): EmittedFile {
  const { flags } = ctx;

  const deps: Record<string, string> = {
    'next': '^15.3.0',
    'react': '^19.0.0',
    'react-dom': '^19.0.0',
    'zustand': '^5.0.0',
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
  lines.push(`    ],`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default nextConfig;`);

  return { path: 'next.config.ts', content: lines.join('\n') };
}

export function emitTailwindConfig(ctx: CodegenCtx): EmittedFile {
  const { customColors } = ctx;

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

export function emitRootLayout(ctx: CodegenCtx): EmittedFile {
  const lines: string[] = [];
  lines.push(`import type { Metadata } from 'next';`);
  lines.push(`import { ThemeProvider } from 'next-themes';`);
  lines.push(`import './globals.css';`);
  lines.push('');

  const appName = (ctx.store as unknown as Record<string, unknown>).projectAppName as string || 'My App';
  lines.push(`export const metadata: Metadata = {`);
  lines.push(`  title: '${appName}',`);
  lines.push(`  description: '${((ctx.store as unknown as Record<string, unknown>).projectDescription as string) || ''}',`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default function RootLayout({ children }: { children: React.ReactNode }) {`);
  lines.push(`  return (`);
  lines.push(`    <html lang="en" suppressHydrationWarning>`);
  lines.push(`      <body>`);
  lines.push(`        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>`);
  lines.push(`          {children}`);
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
