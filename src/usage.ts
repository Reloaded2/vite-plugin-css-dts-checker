import type TS from "@typescript/typescript6";

type Ts = typeof TS;

export interface StyleImport {
  specifier: string;
  decl: TS.ImportDeclaration;
  /** lokale Namen, die das ganze Modul halten (default / namespace) */
  objects: string[];
  /** `import { foo as bar } from "./x.scss"` */
  named: { local: string; className: string }[];
}

export interface Usage {
  used: Set<string>;
  /** `styles[`btn-${size}`]` -> Präfix "btn-" */
  prefixes: string[];
  /** styles wird weitergereicht / dynamisch benutzt -> nichts melden */
  all: boolean;
  referenced: boolean;
}

export function collectStyleImports(
  ts: Ts,
  sf: TS.SourceFile,
  isStyleSpecifier: (s: string) => boolean
): StyleImport[] {
  const out: StyleImport[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier))
      continue;
    const specifier = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly || !isStyleSpecifier(specifier)) continue;

    const imp: StyleImport = { specifier, decl: st, objects: [], named: [] };
    if (clause.name) imp.objects.push(clause.name.text);
    const nb = clause.namedBindings;
    if (nb) {
      if (ts.isNamespaceImport(nb)) imp.objects.push(nb.name.text);
      else
        for (const el of nb.elements) {
          const cls = (el.propertyName ?? el.name).text;
          if (cls === "default") imp.objects.push(el.name.text);
          else imp.named.push({ local: el.name.text, className: cls });
        }
    }
    out.push(imp);
  }
  return out;
}

export function analyzeUsage(
  ts: Ts,
  sf: TS.SourceFile,
  locals: Set<string>
): Map<string, Usage> {
  const usage = new Map<string, Usage>();
  for (const l of locals)
    usage.set(l, { used: new Set(), prefixes: [], all: false, referenced: false });

  const isDeclOrName = (n: TS.Identifier) => {
    const p = n.parent;
    return (
      ts.isImportClause(p) ||
      ts.isImportSpecifier(p) ||
      ts.isNamespaceImport(p) ||
      (ts.isPropertyAccessExpression(p) && p.name === n) ||
      ((ts.isPropertyAssignment(p) ||
        ts.isPropertySignature(p) ||
        ts.isPropertyDeclaration(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isJsxAttribute(p)) &&
        p.name === n) ||
      (ts.isBindingElement(p) && p.propertyName === n)
    );
  };

  const isHandledAccess = (n: TS.Identifier) => {
    const p = n.parent;
    return (
      ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
        p.expression === n) ||
      (ts.isVariableDeclaration(p) &&
        ts.isObjectBindingPattern(p.name) &&
        p.initializer === n) ||
      ts.isTypeQueryNode(p)
    );
  };

  const visit = (node: TS.Node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      usage.get(node.expression.text)?.used.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const u = usage.get(node.expression.text);
      if (u) {
        const a = node.argumentExpression;
        if (ts.isStringLiteralLike(a)) u.used.add(a.text);
        else if (ts.isTemplateExpression(a) && a.head.text)
          u.prefixes.push(a.head.text);
        else u.all = true;
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isIdentifier(node.initializer)
    ) {
      const u = usage.get(node.initializer.text);
      if (u) {
        for (const el of node.name.elements) {
          const k = el.propertyName ?? el.name;
          if (el.dotDotDotToken) u.all = true;
          else if (ts.isIdentifier(k) || ts.isStringLiteral(k)) u.used.add(k.text);
          else u.all = true;
        }
      }
    } else if (ts.isIdentifier(node)) {
      const u = usage.get(node.text);
      if (u && !isDeclOrName(node)) {
        u.referenced = true;
        if (!isHandledAccess(node)) u.all = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return usage;
}
