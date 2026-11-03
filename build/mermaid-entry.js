// Bundled into mods/files-plus/mermaid.bundle.js by build/build.mjs.
// The mod runtime has no timers; elkjs only asks for zero-delay ones, which beautiful-mermaid drains itself.
if (typeof globalThis.setTimeout !== "function") globalThis.setTimeout = () => { throw new Error("setTimeout is not available"); };
export { renderMermaidSVG } from "beautiful-mermaid";
