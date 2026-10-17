// Imports every entry point from dist the way a consumer does, so it also runs on the oldest supported Node.
import { readFileSync } from 'node:fs';

const { name: pkg, exports } = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
for (const entry of Object.keys(exports)) {
	const name = `${pkg}${entry.slice(1)}`;
	if (!Object.keys(await import(name)).length) throw new Error(`${name} exports nothing.`);
}
console.log(`Node ${process.version} imported ${Object.keys(exports).length} entry points.`);
