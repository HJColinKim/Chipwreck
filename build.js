// Builds two single-file outputs from src/:
//   dist/artifact.html — page fragment for publishing as a claude.ai artifact
//   docs/index.html    — full standalone page for GitHub Pages (multiplayer relays through public MQTT brokers)
//
// src/app.ts is the entry point. esbuild bundles it and everything it imports into one
// IIFE, because both outputs have to stay a single self-contained file — the artifact CSP
// blocks external scripts, and docs/index.html is served as a lone static page.
//
// esbuild is pinned to an exact version: `npm run build:check` compares the committed
// bundles byte-for-byte, so a different version's output would fail CI.
//
// docs/ is the Pages deploy directory, so the manifest is copied in alongside the page.
// The icons it points at are generated separately by `npm run icons` and committed.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = import.meta.dirname;
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'app.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8', // keep ’ ♥ ♠ literal rather than \u-escaped
  legalComments: 'none',
  write: false,
});
const js = result.outputFiles[0].text;

const shell = read('shell.html');
const fragment = `${shell}\n<script>\n${js}</script>\n`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), fragment);

const reset = 'html{-webkit-text-size-adjust:100%}:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}';
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d3a31">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ChipWreck">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<style>${reset}</style>
</head>
<body>
${fragment}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'docs', 'index.html'), standalone);
fs.copyFileSync(path.join(root, 'src', 'manifest.webmanifest'), path.join(root, 'docs', 'manifest.webmanifest'));
console.log('Built dist/artifact.html (%d KB), docs/index.html and docs/manifest.webmanifest', Math.round(fragment.length / 1024));
