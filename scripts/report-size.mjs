import { readdir, readFile, stat } from "node:fs/promises";
import { brotliCompressSync, gzipSync } from "node:zlib";

async function collect(path, accept) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collect(child, accept)));
    else if (accept(child)) files.push(child);
  }
  return files;
}
async function measure(files) {
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;
  return { files: files.length, bytes };
}
const source = [
  ...(await collect("shared", (path) => path.endsWith(".ts"))),
  ...(await collect("server", (path) => path.endsWith(".ts"))),
  ...(await collect("client/src", (path) => /\.(ts|css)$/.test(path))),
];
const tests = await collect("tests", (path) => path.endsWith(".ts"));
const scripts = await collect("scripts", (path) => /\.(ts|mjs)$/.test(path));
const dist = await collect("dist/client", () => true);
const bundles = [];
for (const file of dist) {
  const content = await readFile(file);
  bundles.push({
    file,
    bytes: content.length,
    gzipBytes: gzipSync(content).length,
    brotliBytes: brotliCompressSync(content).length,
  });
}
console.log(
  JSON.stringify(
    {
      source: await measure(source),
      tests: await measure(tests),
      scripts: await measure(scripts),
      bundleTotal: {
        files: bundles.length,
        bytes: bundles.reduce((n, x) => n + x.bytes, 0),
        gzipBytes: bundles.reduce((n, x) => n + x.gzipBytes, 0),
        brotliBytes: bundles.reduce((n, x) => n + x.brotliBytes, 0),
      },
      bundles,
    },
    null,
    2,
  ),
);
