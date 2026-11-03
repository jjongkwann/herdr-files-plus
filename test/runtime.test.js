import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("renders an ELK-laid-out diagram under Herdr-like runtime limits", () => {
  const script = `
    const { renderMermaidSVG } = await import(${JSON.stringify(new URL("../mods/files-plus/mermaid.bundle.js", import.meta.url).href)});
    const svg = renderMermaidSVG("flowchart TD\\n A --> B\\n B --> C", { bg: "#000000", fg: "#ffffff" });
    if (!svg.startsWith("<svg")) throw new Error("no svg");
    console.log("ok");`;
  const out = execFileSync(process.execPath, ["--import", new URL("./fixtures/herdr-like-runtime.js", import.meta.url).pathname,
    "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out.trim(), "ok");
});
