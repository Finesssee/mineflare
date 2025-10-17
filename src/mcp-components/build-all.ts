import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Ensure dist directory exists
mkdirSync('src/mcp-components/dist', { recursive: true });

async function buildComponent(name: string, componentPath: string, componentName: string, rootId: string) {
  console.log(`Building ${name}...`);
  
  try {
    const result = await build({
      entryPoints: [componentPath],
      bundle: true,
      format: 'iife',
      write: false,
      jsx: 'automatic',
      jsxImportSource: 'preact',
      minify: true,
      target: 'es2020',
      globalName: 'Component',
    });

    const js = result.outputFiles[0].text;

    // Create HTML template with inlined JavaScript
    const html = `
<div id="${rootId}"></div>
<script type="module">
${js}
// Mount the component
import { h, render } from 'https://esm.sh/preact@10.19.0';
if (window.Component && window.Component.${componentName}) {
  render(h(window.Component.${componentName}), document.getElementById('${rootId}'));
}
</script>
`.trim();

    const outputPath = resolve(`src/mcp-components/dist/${name}.html`);
    writeFileSync(outputPath, html);
    
    console.log(`✓ Built ${name} component (${(js.length / 1024).toFixed(1)}KB)`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to build ${name}:`, error);
    return false;
  }
}

// Build all components
const components = [
  {
    name: 'server-overview',
    path: 'src/mcp-components/server-overview/ServerOverview.tsx',
    componentName: 'ServerOverview',
    rootId: 'server-overview-root',
  },
  {
    name: 'dynmap',
    path: 'src/mcp-components/dynmap/Dynmap.tsx',
    componentName: 'Dynmap',
    rootId: 'dynmap-root',
  },
  {
    name: 'server-action',
    path: 'src/mcp-components/server-action/ServerAction.tsx',
    componentName: 'ServerAction',
    rootId: 'server-action-root',
  },
  // {
  //   name: 'terminal',
  //   path: 'src/mcp-components/terminal/Terminal.tsx',
  //   componentName: 'Terminal',
  //   rootId: 'terminal-root',
  // },
  {
    name: 'rcon-output',
    path: 'src/mcp-components/rcon-output/RconOutput.tsx',
    componentName: 'RconOutput',
    rootId: 'rcon-output-root',
  },
];

let successCount = 0;
for (const component of components) {
  const success = await buildComponent(
    component.name,
    component.path,
    component.componentName,
    component.rootId
  );
  if (success) successCount++;
}

console.log(`\n${successCount}/${components.length} components built successfully`);

if (successCount < components.length) {
  process.exit(1);
}









