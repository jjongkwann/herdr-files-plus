// Mermaid blocks in Markdown previews: split the document, render each diagram to a
// self-contained SVG the native image loader can draw, and cache it on disk.

// The renderer is large (about 1.5 MB of JavaScript), so it loads on the first diagram,
// not with the mod: most previews never need it.
let renderer = null;
const loadRenderer = async () => (renderer ??= (await import("./mermaid.bundle.js")).renderMermaidSVG);

const FENCE = /^(`{3,}|~{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/gm;

/** Splits Markdown into [{ kind: "markdown" | "mermaid", text }], in order. */
export function splitMermaid(markdown) {
  const parts = [];
  let last = 0;
  for (const m of markdown.matchAll(FENCE)) {
    if (m.index > last) parts.push({ kind: "markdown", text: markdown.slice(last, m.index) });
    parts.push({ kind: "mermaid", text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < markdown.length) parts.push({ kind: "markdown", text: markdown.slice(last) });
  return parts.filter(p => p.kind === "mermaid" || p.text.trim());
}

// ---- CSS variables and color-mix() → concrete colors (the SVG loader understands neither).

function hex(c) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const toHex = rgb => "#" + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

function args(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map(a => a.trim());
}

function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function evaluate(expr, vars, seen = new Set()) {
  expr = expr.trim();
  const fn = /^(var|color-mix)\(/.exec(expr);
  if (!fn) return expr;
  const end = closing(expr, fn[0].length - 1);
  const [first, ...rest] = args(expr.slice(fn[0].length, end));
  if (fn[1] === "var") {
    if (vars.has(first) && !seen.has(first)) return evaluate(vars.get(first), vars, new Set([...seen, first]));
    return rest.length ? evaluate(rest.join(","), vars, seen) : "currentColor";
  }
  // color-mix(in srgb, A p%, B [q%])
  const stop = s => { const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(s); return [evaluate(m[1], vars, seen), m[2] === undefined ? null : +m[2]]; };
  const [[a, pa], [b, pb]] = rest.map(stop);
  const ca = hex(a), cb = hex(b);
  if (!ca || !cb) return ca ? a : b;
  const p = pa ?? (pb === null ? 50 : 100 - pb);
  return toHex(ca.map((v, i) => (v * p + cb[i] * (100 - p)) / 100));
}

/** Rewrites an SVG so every color is literal and no remote font is fetched. */
export function flattenSvg(svg, font) {
  font = font.split(",").map(f => f.trim()).map(f => /^[\w-]+$/.test(f) ? f : `'${f.replace(/['"]/g, "")}'`).join(", ");
  const vars = new Map();
  for (const m of svg.matchAll(/(--[\w-]+)\s*:\s*([^;}"]+)/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
  let out = "", i = 0;
  for (;;) {
    const at = svg.slice(i).search(/(var|color-mix)\(/);
    if (at < 0) { out += svg.slice(i); break; }
    const start = i + at, open = svg.indexOf("(", start), end = closing(svg, open);
    if (end < 0) { out += svg.slice(i); break; }
    out += svg.slice(i, start) + evaluate(svg.slice(start, end + 1), vars);
    i = end + 1;
  }
  return out
    .replace(/@import\s+url\([^)]*\)[^;]*;/g, "")
    .replace(/\s*--[\w-]+\s*:\s*[^;}"]+;?/g, "")
    .replace(/font-family\s*:\s*[^;}"]+/g, `font-family: ${font}`)
    .replace(/font-family="[^"]*"/g, `font-family="${font.replaceAll('"', "'")}"`);
}

// Bump when the SVG output changes: the image loader caches by path, so a new look needs a new name.
const RENDER_VERSION = 2;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Herdr theme → diagram colors. */
export function colorsFor(t) {
  return { bg: t.background, fg: t.foreground, line: t.dim, accent: t.ansi4, muted: t.muted, border: t.border };
}

/** The SVG loader resolves real family names and generic sans-serif, but not system-ui. */
export const FONT = "'Helvetica Neue', 'Segoe UI', Arial, 'Noto Sans', sans-serif";

/**
 * Renders one diagram into `<dir>/<hash>.svg` (dir relative to the app folder).
 * Returns { path, width, height } for image(), or throws with Mermaid's message.
 */
export async function renderToFile(source, { appHome, dir, colors, font = FONT, writeTextFile, readTextFile }) {
  const key = hash(JSON.stringify([RENDER_VERSION, source, colors, font]));
  const path = `${dir}/${key}.svg`, full = `${appHome}/${path}`;
  let svg = await readTextFile(full);
  if (svg === null) {
    const render = await loadRenderer();
    svg = flattenSvg(render(source, { ...colors, font, transparent: true }), font);
    await writeTextFile(full, svg, null).catch(async e => { if (await readTextFile(full) === null) throw e; });
  }
  const size = name => +(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)"`).exec(svg)?.[1] ?? 0);
  return { path, width: size("width"), height: size("height") };
}
