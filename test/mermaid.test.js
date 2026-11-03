import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMermaid, flattenSvg } from "../mods/files-plus/mermaid.js";
import { renderMermaidSVG } from "../mods/files-plus/mermaid.bundle.js";

test("splits mermaid fences out of markdown", () => {
  const md = "# T\n\ntext\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nmore\n\n~~~mermaid\nsequenceDiagram\n A->>B: hi\n~~~\n";
  assert.deepEqual(splitMermaid(md).map(p => p.kind), ["markdown", "mermaid", "markdown", "mermaid"]);
  assert.equal(splitMermaid(md)[1].text, "flowchart LR\n A --> B");
});

test("leaves other code fences alone", () => {
  assert.deepEqual(splitMermaid("```js\nx\n```\n").map(p => p.kind), ["markdown"]);
});

for (const [name, src] of Object.entries({
  flowchart: "flowchart TD\n A[Start] --> B{Ok?}\n B -->|yes| C[(DB)]",
  sequence: "sequenceDiagram\n A->>B: hi",
  er: "erDiagram\n U ||--o{ O : places",
  xychart: "xychart-beta\n x-axis [a,b,c]\n bar [1,2,3]",
})) test(`flattens ${name} to literal colors`, () => {
  const svg = flattenSvg(renderMermaidSVG(src, { bg: "#1d2021", fg: "#ebdbb2", transparent: true }), "Helvetica");
  assert.doesNotMatch(svg, /var\(|color-mix|@import|--[\w-]+\s*:/);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<style>\s*text \{ font-family: Helvetica; \}/);
});
