'use strict';

const fs = require('node:fs');

const [, , filePath, mode, hostArg] = process.argv;
if (!filePath || !mode) {
  console.error('Usage: node PATCH-SHOP-WRANGLER.cjs <config.json> <source|deploy> [host|-]');
  process.exit(2);
}

const host = hostArg && hostArg !== '-' ? hostArg.trim() : '';
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error(`Cannot parse Wrangler JSON: ${filePath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(3);
}

if (mode === 'source') {
  cfg.main = '@astrojs/cloudflare/entrypoints/server';
} else if (mode !== 'deploy') {
  console.error(`Unknown mode: ${mode}`);
  process.exit(4);
}

if (host) {
  delete cfg.route;

  let routes = [];
  if (Array.isArray(cfg.routes)) {
    routes = cfg.routes.slice();
  } else if (cfg.routes != null) {
    // Normalize any legacy/single-object value instead of emitting invalid Wrangler JSON.
    routes = [cfg.routes];
  }

  routes = routes.filter((route) => {
    if (typeof route === 'string') {
      return route !== host && route !== `${host}/*`;
    }
    if (!route || typeof route !== 'object') return true;
    return route.pattern !== host && route.pattern !== `${host}/*`;
  });

  routes.push({ pattern: host, custom_domain: true });
  cfg.routes = routes;
}

fs.writeFileSync(filePath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');

// Read back and fail fast on the exact shape Wrangler requires.
const check = JSON.parse(fs.readFileSync(filePath, 'utf8'));
if (mode === 'source' && check.main !== '@astrojs/cloudflare/entrypoints/server') {
  console.error('Source Wrangler main normalization failed.');
  process.exit(5);
}
if (host) {
  if (!Array.isArray(check.routes)) {
    console.error('Wrangler routes must be a JSON array.');
    process.exit(6);
  }
  const match = check.routes.find((route) =>
    route && typeof route === 'object' && route.pattern === host && route.custom_domain === true
  );
  if (!match) {
    console.error(`Custom-domain route missing after patch: ${host}`);
    process.exit(7);
  }
}

console.log(`Wrangler JSON patch - PASS (${mode}${host ? `, ${host}` : ''})`);
