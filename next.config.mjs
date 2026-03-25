import { withGluestackUI } from '@gluestack/ui-next-adapter';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'react-native-reanimated',
    'react-native-gesture-handler',
    'react-native-worklets',
    'react-native-linear-gradient',
  ],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', pathname: '/**' },
      { protocol: 'http', hostname: 'preview.localhost', pathname: '/**' },
      { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' },
      { protocol: 'https', hostname: '*.unsplash.com', pathname: '/**' },
      { protocol: 'https', hostname: 'placehold.co', pathname: '/**' },
    ],
  },
  webpack(config) {
    // Stub native-only libraries so they resolve cleanly on web.
    // @shopify/react-native-skia: stubbed because its WASM build is incompatible
    // with Next.js's webpack config without additional setup.
    // react-native-linear-gradient: stubbed to a CSS-based web implementation.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@shopify/react-native-skia': path.resolve(__dirname, 'lib/sdui/stubs/skia-stub.ts'),
      '@react-native-masked-view/masked-view': path.resolve(__dirname, 'lib/sdui/stubs/masked-view-stub.ts'),
      'react-native-linear-gradient': path.resolve(__dirname, 'lib/sdui/stubs/linear-gradient-web.tsx'),
    };
    return config;
  },
};

export default withGluestackUI(nextConfig);
