import path from "node:path";
import { createFilter, type FilterPattern, type Plugin } from "vite";
import type TS from "@typescript/typescript6"
import { defaultDtsCandidates, findDts, readClassNames } from "./dts.js";
import { analyzeUsage, collectStyleImports } from "./usage.js";

export interface CssDtsCheckerOptions {
  /** Dateien, die geprüft werden. Default: js/ts/jsx/tsx */
  include?: FilterPattern;
  /** Default: node_modules */
  exclude?: FilterPattern;
  /** Style-Endungen, die geprüft werden. Default: css, scss, sass, less */
  extensions?: string[];
  /** Klassen, die nie gemeldet werden (z.B. State-Klassen) */
  ignoreClasses?: (string | RegExp)[];
  /** "warn" (Default) oder "error" -> Build bricht ab */
  severity?: "warn" | "error";
  /** Eigene Auflösung der .d.ts-Datei zu einer Style-Datei */
  dts?: (styleFile: string) => string[];
  /** Nur im "build" oder nur im "serve" aktiv */
  apply?: "build" | "serve";
}

const SCRIPT_KIND = {
  ".tsx": "TSX",
  ".jsx": "JSX",
  ".ts": "TS",
  ".mts": "TS",
  ".cts": "TS",
} as const;

const stripQuery = (id: string) => id.replace(/[?#].*$/, "");

export default function cssDtsChecker(options: CssDtsCheckerOptions = {}): Plugin {
  const {
    include = /\.[cm]?[jt]sx?$/,
    exclude = /node_modules/,
    extensions = ["css", "scss", "sass", "less"],
    ignoreClasses = [],
    severity = "warn",
    dts = defaultDtsCandidates,
    apply,
  } = options;

  const filter = createFilter(include, exclude);
  const extPattern = extensions.map((e) => e.replace(/^\./, "")).join("|");
  // schneller Vorab-Check, bevor überhaupt geparst wird
  const quickRe = new RegExp(`\\.(?:${extPattern})(?:\\?[^'"\`]*)?['"\`]`);
  const specRe = new RegExp(`\\.(?:${extPattern})$`);
  const isStyleSpecifier = (s: string) =>
    !/[?&](?:inline|url|raw)\b/.test(s) && specRe.test(stripQuery(s));
  const isIgnored = (name: string) =>
    ignoreClasses.some((i) => (typeof i === "string" ? i === name : i.test(name)));

  let ts: typeof TS | undefined;
  let root = process.cwd();

  return {
    name: "css-dts-checker",
    enforce: "pre",
    apply,

    configResolved(config) {
      root = config.root;
    },

    async transform(code, id) {
      const file = stripQuery(id);
      if (!filter(file) || !quickRe.test(code)) return null;

      if (!ts) {
        const module = await import("typescript");
        // TypeScript can expose its API through different ESM/CJS interop shapes.
        // Check the actual API instead of blindly preferring `default`.
        const candidates: unknown[] = [
          module,
          module.default,
          (module.default as { default?: unknown } | undefined)?.default,
        ];
        const api = candidates.find((value): value is typeof TS => {
          if (!value || typeof value !== "object") return false;
          const candidate = value as Partial<typeof TS>;
          return (
            typeof candidate.createSourceFile === "function" &&
            candidate.ScriptKind?.TSX !== undefined &&
            candidate.ScriptTarget?.Latest !== undefined
          );
        });
        if (!api) {
          throw new Error(
            "css-dts-checker: Cannot load the TypeScript compiler API (missing ScriptKind/createSourceFile)."
          );
        }
        ts = api;
      }
      const T = ts;

      const ext = path.extname(file) as keyof typeof SCRIPT_KIND;
      const kind = T.ScriptKind[SCRIPT_KIND[ext] ?? "JS"];
      const sf = T.createSourceFile(file, code, T.ScriptTarget.Latest, true, kind);

      const imports = collectStyleImports(T, sf, isStyleSpecifier);
      if (imports.length === 0) return null;

      // pro aufgelöster Style-Datei zusammenfassen
      const groups = new Map<
        string,
        {
          names: Set<string>;
          objects: string[];
          named: { local: string; className: string }[];
          decl: TS.ImportDeclaration;
        }
      >();

      for (const imp of imports) {
        const resolved = await this.resolve(stripQuery(imp.specifier), id, {
          skipSelf: true,
        });
        if (!resolved || resolved.external) continue;
        const styleFile = stripQuery(resolved.id);

        const dtsFile = findDts(dts(styleFile));
        if (!dtsFile) continue;
        this.addWatchFile(dtsFile);

        const g = groups.get(styleFile) ?? {
          names: readClassNames(T, dtsFile),
          objects: [],
          named: [],
          decl: imp.decl,
        };
        g.objects.push(...imp.objects);
        g.named.push(...imp.named);
        groups.set(styleFile, g);
      }
      if (groups.size === 0) return null;

      const locals = new Set<string>();
      for (const g of groups.values()) {
        g.objects.forEach((o) => locals.add(o));
        g.named.forEach((n) => locals.add(n.local));
      }
      const usage = analyzeUsage(T, sf, locals);

      for (const [styleFile, g] of groups) {
        const used = new Set<string>();
        const prefixes: string[] = [];
        let all = false;

        for (const o of g.objects) {
          const u = usage.get(o)!;
          all ||= u.all;
          u.used.forEach((c) => used.add(c));
          prefixes.push(...u.prefixes);
        }
        for (const n of g.named) {
          if (usage.get(n.local)!.referenced) used.add(n.className);
        }
        if (all) continue;

        const unused = [...g.names].filter(
          (n) => !used.has(n) && !prefixes.some((p) => n.startsWith(p)) && !isIgnored(n)
        );
        if (unused.length === 0) continue;

        const { line, character } = sf.getLineAndCharacterOfPosition(g.decl.getStart());
        const message = `Ungenutzte Klassen aus ${path.relative(root, styleFile)}: ${unused.join(", ")}`;
        const payload = {
          message,
          id: file,
          loc: { file, line: line + 1, column: character + 1 },
        };
        if (severity === "error") this.error(payload);
        else this.warn(payload);
      }

      return null;
    },
  };
}

export { cssDtsChecker };
