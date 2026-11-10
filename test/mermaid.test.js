import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMermaid, flattenSvg, renderToFile } from "../mods/files-plus/mermaid.js";
import { renderMermaidSVG } from "../mods/files-plus/mermaid.bundle.js";

test("splits mermaid fences out of markdown", () => {
  const md = "# T\n\ntext\n\n```mermaid\nflowchart LR\n A --> B\n```\n\nmore\n\n~~~mermaid\nsequenceDiagram\n A->>B: hi\n~~~\n";
  assert.deepEqual(splitMermaid(md).map(p => p.kind), ["markdown", "mermaid", "markdown", "mermaid"]);
  assert.equal(splitMermaid(md)[1].text, "flowchart LR\n A --> B");
});

test("keeps an unclosed mermaid fence as markdown", () => {
  assert.deepEqual(splitMermaid("a\n```mermaid\nflowchart LR\n A-->B\n").map(p => p.kind), ["markdown"]);
});

test("splits quickly with many unclosed fences", () => {
  const t = Date.now();
  splitMermaid("```mermaid\n".repeat(20000));
  assert.ok(Date.now() - t < 2000);
});

test("leaves diagram text that looks like CSS alone", () => {
  const svg = flattenSvg(renderMermaidSVG("flowchart LR\n A[\"var(--fg) and --x: 1\"] --> B", { bg: "#000000", fg: "#ffffff" }), "Arial");
  assert.match(svg, /var\(--fg\) and --x: 1/);
});

test("leaves other code fences alone", () => {
  assert.deepEqual(splitMermaid("```js\nx\n```\n").map(p => p.kind), ["markdown"]);
});

test("leaves a mermaid example inside another fence alone", () => {
  assert.deepEqual(splitMermaid("````markdown\n```mermaid\nflowchart LR\n A-->B\n```\n````\n").map(p => p.kind), ["markdown"]);
  assert.deepEqual(splitMermaid("```md\n~~~mermaid\nflowchart LR\n A-->B\n~~~\n```\n").map(p => p.kind), ["markdown"]);
});

test("finds an indented fence in a list item", () => {
  const parts = splitMermaid("- item\n\n  ```mermaid\n  flowchart LR\n   A-->B\n  ```\n- next\n");
  assert.deepEqual(parts.map(p => p.kind), ["markdown", "mermaid", "markdown"]);
  assert.equal(parts[1].text, "flowchart LR\n A-->B");
});

test("mixes colors as color-mix(in srgb) does", () => {
  const svg = '<svg style="--a:#000000;--b:#ffffff"><style>text { fill: color-mix(in srgb, var(--a) 25%, var(--b)); }</style><rect fill="var(--c, var(--b))"/></svg>';
  const out = flattenSvg(svg, "Arial");
  assert.match(out, /fill: #bfbfbf;/);
  assert.match(out, /<rect fill="#ffffff"\/>/);
});

test("renders a diagram to a file once and reuses it", async () => {
  const files = new Map();
  let writes = 0;
  const io = { appHome: "/home", dir: "data/x", colors: { bg: "#000000", fg: "#ffffff" },
    readTextFile: async path => files.get(path) ?? null,
    writeTextFile: async (path, text) => { writes++; files.set(path, text); return null; } };
  const first = await renderToFile("flowchart LR\n A --> B", io);
  const again = await renderToFile("flowchart LR\n A --> B", io);
  const other = await renderToFile("flowchart LR\n A --> C", io);
  assert.deepEqual(again, first);
  assert.equal(writes, 2);
  assert.notEqual(other.path, first.path);
  assert.match(first.path, /^data\/x\/[0-9a-z]+\.svg$/);
  assert.ok(first.width > 0 && first.height > 0);
  assert.ok(files.has(`/home/${first.path}`));
  await assert.rejects(renderToFile("pie\n \"a\": 1", io));
});

for (const [name, src] of Object.entries({
  flowchart: "flowchart TD\n A[Start] --> B{Ok?}\n B -->|yes| C[(DB)]",
  sequence: "sequenceDiagram\n A->>B: hi",
  er: "erDiagram\n U ||--o{ O : places",
  class: "classDiagram\n class A\n A <|-- B",
  state: "stateDiagram-v2\n [*] --> A\n A --> [*]",
  xychart: "xychart-beta\n x-axis [a,b,c]\n bar [1,2,3]",
})) test(`flattens ${name} to literal colors`, () => {
  const svg = flattenSvg(renderMermaidSVG(src, { bg: "#1d2021", fg: "#ebdbb2", transparent: true }), "Helvetica");
  assert.doesNotMatch(svg, /var\(|color-mix|@import|--[\w-]+\s*:/);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<style>\s*text \{ font-family: Helvetica; \}/);
});
