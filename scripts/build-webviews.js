#!/usr/bin/env node

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const entryPoints = {
  'todoView': './src/webviews/entries/todoView.tsx',
  'documentView': './src/webviews/entries/documentView.tsx',
  'documentEditor': './src/webviews/entries/documentEditor.tsx',
};

const buildOptions = {
  entryPoints,
  bundle: true,
  outdir: path.join(__dirname, '../dist/webviews'),
  external: ['vscode'],
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: production,
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
  },
};

async function build() {
  try {
    if (watch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('[webview-build] Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('[webview-build] Build complete');
    }
  } catch (error) {
    console.error('[webview-build] Build failed:', error);
    process.exit(1);
  }
}

build();
