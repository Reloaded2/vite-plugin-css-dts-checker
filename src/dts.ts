import fs from "node:fs";
import type TS from "@typescript/typescript6";

type Ts = typeof TS;

const cache = new Map<string, { mtimeMs: number; names: Set<string> }>();

/** typed-css-modules / typed-scss-modules: `x.scss.d.ts`, TS-Variante: `x.d.scss.ts` */
export function defaultDtsCandidates(styleFile: string): string[] {
  const m = /^(.*)\.([^./\\]+)$/.exec(styleFile);
  const list = [`${styleFile}.d.ts`];
  if (m) list.push(`${m[1]}.d.${m[2]}.ts`);
  return list;
}

export function findDts(
  candidates: string[]
): string | undefined {
  return candidates.find((c) => fs.existsSync(c));
}

/** Liest die Klassennamen aus einer .d.ts – nur Parser, kein Program/TypeChecker. */
export function readClassNames(ts: Ts, dtsFile: string): Set<string> {
  const { mtimeMs } = fs.statSync(dtsFile);
  const hit = cache.get(dtsFile);
  if (hit && hit.mtimeMs === mtimeMs) return hit.names;

  const sf = ts.createSourceFile(
    dtsFile,
    fs.readFileSync(dtsFile, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const names = new Set<string>();

  const addMembers = (members: TS.NodeArray<TS.TypeElement>) => {
    for (const m of members) {
      const n = m.name;
      if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n))) names.add(n.text);
    }
  };
  const addType = (t?: TS.TypeNode) => {
    if (t && ts.isTypeLiteralNode(t)) {
      addMembers(t.members);
      return true;
    }
    return false;
  };

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const exported = st.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword
      );
      for (const d of st.declarationList.declarations) {
        // `declare const styles: { foo: string }` -> foo ; `export const foo: string` -> foo
        if (!addType(d.type) && exported && ts.isIdentifier(d.name)) {
          names.add(d.name.text);
        }
      }
    } else if (ts.isInterfaceDeclaration(st)) {
      addMembers(st.members);
    } else if (ts.isTypeAliasDeclaration(st)) {
      if (!addType(st.type) && st.name.text === "ClassNames") {
        // export type ClassNames = 'a' | 'b'
        const walk = (t: TS.TypeNode) => {
          if (ts.isUnionTypeNode(t)) t.types.forEach(walk);
          else if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
            names.add(t.literal.text);
        };
        walk(st.type);
      }
    }
  }

  cache.set(dtsFile, { mtimeMs, names });
  return names;
}
