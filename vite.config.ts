import { defineConfig } from 'vite';
import { rnw } from 'vite-plugin-rnw';
import babel from 'vite-plugin-babel';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    // Handles: react-native → react-native-web alias, .web.* extensions,
    // Flow stripping, .js-as-jsx transform, RN globals (__DEV__, global,
    // _WORKLET, etc.), NativeWind jsxImportSource, and @vitejs/plugin-react.
    rnw({
      jsxImportSource: 'nativewind',
      babel: { plugins: ['react-native-worklets/plugin'] },
    }),

    // Transforms CJS-style require() patterns in RN node_modules to proper ESM
    // so Rolldown (Vite 8) doesn't choke on module-init-order or CJS interop.
    babel({
      filter: /node_modules\/(react-native|@react-native|react-native-reanimated|react-native-gesture-handler|react-native-svg|react-native-worklets)/,
      babelConfig: {
        babelrc: false,
        configFile: false,
        plugins: [
          [
            '@babel/plugin-transform-modules-commonjs',
            { strict: false, strictMode: false, allowTopLevelThis: true },
          ],
        ],
      },
    }),
  ],

  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, '.') },
      // Genuinely native-only libs with no usable web build — keep stubbing.
      { find: '@shopify/react-native-skia',            replacement: path.resolve(__dirname, 'lib/sdui/stubs/skia-stub.ts') },
      { find: '@react-native-masked-view/masked-view',  replacement: path.resolve(__dirname, 'lib/sdui/stubs/masked-view-stub.ts') },
      { find: 'react-native-linear-gradient',           replacement: path.resolve(__dirname, 'lib/sdui/stubs/linear-gradient-web.tsx') },
      // Force the web entry (resolves to ReactNativeSVG.web.js via .web.* ext
      // priority). It pulls its own `parse` from ./xml and never touches the
      // native-only PEG.js `lib/extract/transform.js` CommonJS parser, which
      // Rolldown can't enumerate named exports from. (react-native-svg #2254)
      { find: /^react-native-svg$/, replacement: 'react-native-svg/lib/module/ReactNativeSVG' },
    ],
    dedupe: ['react', 'react-dom', 'react-native-web'],
  },

  define: {
    // rnw() already injects __DEV__, global, _WORKLET, _frameTimestamp,
    // and process.env.NODE_ENV — add only what it doesn't cover.
    'process.env.JEST_WORKER_ID': JSON.stringify(undefined),
    'process.env.EXPO_PUBLIC_ENV': JSON.stringify(undefined),
  },

  server: {
    port: 3001,
    fs: { strict: false },
  },
}));
