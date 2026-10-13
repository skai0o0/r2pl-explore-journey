import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M4 QA Knowledge explore uses the selected isometric tile and preserves exact retry", async () => {
  const [panel, main, html] = await Promise.all([
    readFile(
      new URL("../client/src/knowledgePanel.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../client/src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../client/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(
    main,
    /mountKnowledgePanel\(world,\s*\(\)\s*=>\s*selected\?\.index\)/,
  );
  assert.match(main, /if \(!integratedQa\) explore\(\)/);
  assert.match(panel, /const tileIndex = selectedTileIndex\(\)/);
  assert.match(
    panel,
    /lastExplore = \{ commandId: crypto\.randomUUID\(\), tileIndex \}/,
  );
  assert.match(
    panel,
    /command\("\/api\/qa\/knowledge\/explore", lastExplore\)/,
  );
  assert.match(panel, /Number\.isInteger\(tileIndex\)/);
  assert.match(html, /Select an isometric tile for Knowledge/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
});
