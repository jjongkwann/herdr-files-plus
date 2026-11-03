// Rebuilds the vendored Mermaid renderer: node build/build.mjs
import { build } from "esbuild";
import { readFileSync } from "node:fs";

// elkjs assumes a browser, Node or worker global; the Herdr mod runtime is none of these.
// Each patch must apply exactly once, so an elkjs update that moves the code fails the build.
const ELK_PATCHES = [
  // Built-in prototypes are frozen, so assigning toString on elkjs's base prototype throws.
  ["_.toString=function(){return this.Ib()}",
   'Object.defineProperty(_,"toString",{value:function(){return this.Ib()},writable:true,configurable:true})'],
  // No window/global/self here: GWT's $wnd must still reach Math, Error and friends.
  ["    $wnd = self // web worker\n",
   "    $wnd = self // web worker\nif (!$wnd || !$wnd.Math) $wnd = globalThis;\n"],
];
const freezeSafeElk = {
  name: "freeze-safe-elk",
  setup(b) {
    b.onLoad({ filter: /elkjs[\\/]lib[\\/]elk\.bundled\.js$/ }, async args => {
      let src = readFileSync(args.path, "utf8");
      for (const [from, to] of ELK_PATCHES) {
        if (src.split(from).length !== 2) throw new Error(`elkjs changed, patch no longer applies: ${from.trim()}`);
        src = src.replace(from, to);
      }
      return { contents: src, loader: "js" };
    });
  },
};
const pkg = JSON.parse(readFileSync(new URL("../node_modules/beautiful-mermaid/package.json", import.meta.url)));
await build({
  entryPoints: [new URL("./mermaid-entry.js", import.meta.url).pathname],
  outfile: new URL("../mods/files-plus/mermaid.bundle.js", import.meta.url).pathname,
  bundle: true, plugins: [freezeSafeElk], format: "esm", platform: "neutral", target: "es2020", minify: true, legalComments: "eof",
  banner: { js: `// beautiful-mermaid ${pkg.version} (MIT) with elkjs (EPL-2.0) and entities (BSD-2-Clause), bundled. Rebuild: node build/build.mjs` },
});
console.log("built mermaid.bundle.js from beautiful-mermaid", pkg.version);
