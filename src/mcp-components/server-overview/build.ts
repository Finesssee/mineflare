import { build } from 'esbuild';
import { readFileSync } from 'fs';

const jsResult = await build({
  entryPoints: ['src/mcp-components/server-overview/ServerOverview.tsx'],
  bundle: true,
  format: 'esm',
  write: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  target: 'es2020',
  external: [],
});

const js = jsResult.outputFiles[0].text;

const html = `
<div id="server-overview-root"></div>
<script type="module">
${js}
import { h, render } from 'preact';
import { ServerOverview } from './ServerOverview';
render(h(ServerOverview), document.getElementById('server-overview-root'));
</script>
`.trim();

await Bun.write('src/mcp-components/dist/server-overview.html', html);

console.log('✓ Built server-overview component');








