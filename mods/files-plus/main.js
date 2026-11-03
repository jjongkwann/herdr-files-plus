// A lazy file browser for the focused pane's folder, with bounded read-only previews.
// files-plus: wrapped source view, rendered Markdown/HTML previews with Mermaid diagrams, wider language table.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, appHome, watchFolder, theme, settings, window } from "herdr";
import { splitMermaid, renderToFile, colorsFor } from "./mermaid.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
// Names the editor highlights were checked one by one; extensions it doesn't know map to a close grammar or stay plain.
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json", json5: "json",
  svelte: "html", vue: "html", astro: "html", htm: "html", xhtml: "html", svg: "xml", plist: "xml", h: "c", hpp: "cpp", hh: "cpp", cc: "cpp", cxx: "cpp",
  csharp: "cs", zsh: "zsh", ksh: "bash", mk: "make", el: "lisp", lisp: "lisp", ml: "ocaml", mli: "ocaml", hs: "haskell", rake: "rb", gemspec: "rb" };
const NAMES = { makefile: "make", gnumakefile: "make", gemfile: "rb", rakefile: "rb", ".zshrc": "zsh", ".zprofile": "zsh", ".zshenv": "zsh",
  ".bashrc": "bash", ".bash_profile": "bash", ".profile": "bash" };
const PREVIEW = { md: "markdown", markdown: "markdown", mdx: "markdown", html: "html", htm: "html" };
const extOf = path => { const name = path.split("/").pop(); return name.includes(".") ? name.split(".").pop().toLowerCase() : ""; };
const langOf = path => { const name = path.split("/").pop().toLowerCase(), ext = extOf(path); return NAMES[name] ?? LANG[ext] ?? (ext || "txt"); };
const PER_FOLDER = 500, TOTAL = 5000;
// Rendered diagrams. Not under mods/: Herdr reloads mods on writes there and skips images from symlinked mod folders.
const DIAGRAMS = "data/files-plus";
const OPENER = { macos: ["open", []], linux: ["xdg-open", []], windows: ["cmd", ["/c", "start", ""]] };

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.text = null; this.parts = null; this.file = path; this.fileError = null;
    this.mode = path && PREVIEW[extOf(path)] ? "preview" : "source";
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), value = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        this.text = value;
        if (PREVIEW[extOf(path)] === "markdown") {
          const parts = splitMermaid(value);
          if (parts.some(p => p.kind === "mermaid")) { this.parts = parts; this.renderDiagrams(cx); }
        }
        this.code = EditorState.new({ language: langOf(path), readonly: true, soft_wrap: true, value,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  renderDiagrams(cx) {
    const parts = this.parts, colors = colorsFor(theme());
    this.diagramColors = JSON.stringify(colors);
    for (const p of parts) if (p.kind === "mermaid") p.diagram = p.diagram ?? { loading: true };
    cx.spawn(async cx => {
      for (const p of parts) {
        if (p.kind !== "mermaid") continue;
        if (this.parts !== parts) return;
        try { p.diagram = await renderToFile(p.text, { appHome: appHome(), dir: DIAGRAMS, colors, writeTextFile, readTextFile }); }
        catch (e) { p.diagram = { error: String(e?.message ?? e) }; }
        cx.notify();
      }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files-plus/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-plus/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    if (this.parts && this.diagramColors !== JSON.stringify(colorsFor(t))) this.renderDiagrams(cx);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .children(this.tools(t)))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.viewer(t)));
  }

  viewer(t) {
    if (!this.code) return div().p(12).text_color(t.dim).child(this.fileError || "Loading file…");
    const kind = PREVIEW[extOf(this.file)];
    if (kind && this.mode === "preview" && this.parts)
      return v_flex().id("files-preview").flex_1().min_h(0).overflow_y_scrollbar().px(16).py(10).gap(10)
        .on_size_change((size, cx) => { if (size.width !== this.previewWidth) { this.previewWidth = size.width; cx.notify(); } })
        .children(this.parts.map((p, i) => p.kind === "markdown"
          ? TextView.markdown(`preview-${this.file}-${i}`, p.text).selectable(true)
          : this.diagram(p, i, t)));
    if (kind && this.mode === "preview")
      return div().id("files-preview").flex_1().min_h(0).px(16).py(10)
        .child((kind === "html" ? TextView.html : TextView.markdown)(`preview-${this.file}`, this.text).selectable(true).scrollable(true).size_full());
    return Editor.new(this.code).flex_1().min_h(0);
  }

  diagram(p, i, t) {
    const d = p.diagram ?? {};
    if (d.path && d.width && d.height) {
      const w = Math.min(d.width, Math.max(80, (this.previewWidth ?? d.width + 32) - 32));
      return div().id(`diagram-${i}`).flex_none().child(image(d.path).w(w).h(w * d.height / d.width));
    }
    return v_flex().id(`diagram-${i}`).flex_none().gap(4).p(10).rounded(6).border_1().border_color(t.border)
      .child(div().text_size(11).text_color(d.error ? t.ansi1 : t.dim).child(d.error ? `Mermaid: ${d.error}` : "Rendering diagram…"))
      .when(Boolean(d.error), el => el.child(div().text_size(12).font_family(settings().font_family).text_color(t.muted).child(p.text)));
  }

  tools(t) {
    const kind = this.file && this.code ? PREVIEW[extOf(this.file)] : null;
    const button = (id, label, onClick) => div().id(id).px(7).py(2).rounded(6).text_size(11).text_color(t.muted).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(onClick).child(label);
    const out = [];
    if (kind) out.push(button("files-mode", this.mode === "preview" ? "Source" : "Preview", (_e, cx) => { this.mode = this.mode === "preview" ? "source" : "preview"; cx.notify(); }));
    const opener = OPENER[window()?.platform];
    if (kind === "html" && !this.on && opener)
      out.push(button("files-browser", "Open in browser", (_e, cx) => { cx.spawn(async () => { await exec(opener[0], [...opener[1], `${this.root}/${this.file}`]); }); }));
    return out;
  }
}
