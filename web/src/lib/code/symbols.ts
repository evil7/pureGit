/**
 * 代码符号提取（仿 Gitea `collectSymbols` —— 直接遍历 CM6 的 Lezer 语法树，
 * 零依赖、零 API：语言解析（lezer）在 CM6 加载语言时已自动完成，本层只做「读树」）。
 *
 * 覆盖 16 种已装语言（js/ts/jsx/tsx/json/md/yaml/css/html/python/sql/java/cpp/rust/go/php）：
 * - JS/TS 系（@lezer/javascript）：FunctionDeclaration/ClassDeclaration/VariableDefinition/PropertyDefinition 等
 * - Python（@lezer/python）：FunctionDefinition/ClassDefinition
 * - Java（@lezer/java）：MethodDeclaration/ClassDeclaration/FieldDeclaration
 * - Go（@lezer/go）：FuncDecl/TypeSpec/VarDecl/ConstSpec
 * - Rust（@lezer/rust）：FunctionItem/StructItem/EnumItem/ConstItem/StaticItem
 * - C/C++（@lezer/cpp）：FunctionDefinition/ClassSpecifier/StructSpecifier
 * - PHP（@lezer/php）：FunctionDeclaration/ClassDeclaration
 *
 * 与官方 GitHub symbols 面板（web worker + tree-sitter）结果近似；官方不公开，Gitea 同方案。
 */

import type { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

export interface SymbolInfo {
  /** 符号名（如 "apiLog"） */
  label: string;
  /** 分类（官方/Gitea 同款）：function / method / class / interface / variable / property / field / type / enum / const */
  kind: string;
  /** 文档内字符位置（跳转用） */
  from: number;
  /** 所在行号（1-based，跳转用） */
  line: number;
}

/** 引用条目（官方 References in this file：行号 + 行内容片段） */
export interface SymbolRef {
  /** 引用所在行号（1-based） */
  line: number;
  /** 该行文本（trim，供列表展示） */
  text: string;
}

/** 定义类节点 → 符号分类（跨语言通用节点名；各 lezer 语法共享的命名约定） */
const KIND_BY_NODE: Record<string, string> = {
  // JS/TS / JSX / TSX（@lezer/javascript）
  FunctionDeclaration: "function",
  ClassDeclaration: "class",
  VariableDefinition: "variable",
  PropertyDefinition: "property",
  ArrowFunction: "function",
  // Python（@lezer/python）
  FunctionDefinition: "function",
  ClassDefinition: "class",
  // Java（@lezer/java）
  MethodDeclaration: "method",
  FieldDeclaration: "field",
  InterfaceDeclaration: "interface",
  // Go（@lezer/go）
  FuncDecl: "function",
  TypeSpec: "type",
  VarDecl: "variable",
  ConstSpec: "const",
  MethodSpec: "method",
  // Rust（@lezer/rust）
  FunctionItem: "function",
  StructItem: "type",
  EnumItem: "enum",
  TraitItem: "interface",
  ImplItem: "impl",
  ConstItem: "const",
  StaticItem: "const",
  // C/C++（@lezer/cpp）
  ClassSpecifier: "type",
  StructSpecifier: "type",
  EnumSpecifier: "enum",
  // PHP（@lezer/php）
  ConstDeclaration: "const",
  // CSS（@lezer/css）
  StyleRule: "class",
};

/** 名字子节点候选（各语法给「符号名」节点的命名；取第一个命中） */
const NAME_NODE_RE =
  /^(VariableDefinition|DefName|PropertyName|PropertyDefinition|identifier|name|FunctionName|ClassName|TypeName|FieldName|Type)$/;

/**
 * 收集文件内指定符号的全部**引用**（官方 References in this file 同语义）。
 * 方案：**全文正则扫描符号名**（覆盖 identifier / JSX 标签 / 属性访问等所有形态；
 * lezer 的 JSX 标签名是节点**字段**而非子节点/文本，逐节点提取不可行）+
 * **语法树裁决**：每个命中用 lezer 树 `resolve` 判断是否在注释/字符串内（误报剔除）；
 * 排除定义本身（from 相同）；同一行多个引用只记一次（官方按行列出）。
 */
export function collectReferences(view: EditorView, symbol: SymbolInfo): SymbolRef[] {
  const doc = view.state.doc;
  const tree = fullTree(view);
  const text = doc.sliceString(0);
  const refs: SymbolRef[] = [];
  const seenLines = new Set<number>();
  const esc = symbol.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const pos = m.index;
    if (pos === symbol.from) continue; // 定义本身不算引用
    // 语法树裁决：命中在注释/字符串/正则内 → 剔除（官方 References 只列代码引用）
    const node = tree.resolve(pos, -1);
    let inLiteral = false;
    for (let cur: SyntaxNode | null = node; cur; cur = cur.parent) {
      if (
        /^(LineComment|BlockComment|Comment|String|TemplateString|Regex|RegExp)$/.test(cur.name)
      ) {
        inLiteral = true;
        break;
      }
    }
    if (inLiteral) continue;
    const line = doc.lineAt(pos).number;
    if (seenLines.has(line)) continue;
    seenLines.add(line);
    refs.push({ line, text: doc.line(line).text.trim() });
  }
  return refs;
}

/**
 * 取「解析到文档末尾」的完整语法树。
 * CM6 lezer 解析是**惰性/增量**的：`syntaxTree(state)` 只含已渲染（可视区）部分，
 * 大文件在 mount 时仅解析前 ~100 行 → 提取的符号/引用只有开头几个（实测）。
 * `ensureSyntaxTree(state, doc.length)` 强制同步解析到末尾（超时 1000ms，数千行足够）。
 */
function fullTree(view: EditorView) {
  const doc = view.state.doc;
  return ensureSyntaxTree(view.state, doc.length, 1000) ?? syntaxTree(view.state);
}

/**
 * 收集文件内全部符号定义（按文档位置升序）。
 * 遍历 lezer 语法树：命中「定义类节点」→ 取其名字子节点文本 + 分类 + 位置；
 * return false 跳过子树（函数体内的嵌套定义不重复收集，官方同语义）。
 */
export function collectSymbols(view: EditorView): SymbolInfo[] {
  const tree = fullTree(view);
  const doc = view.state.doc;
  const symbols: SymbolInfo[] = [];
  const seen = new Set<number>();

  tree.iterate({
    enter(node) {
      const kind = KIND_BY_NODE[node.name];
      if (!kind) return;
      // 取名字子节点（避免收集 "function()" 整段）
      const nameNode = findNameChild(node.node);
      if (!nameNode) return;
      if (seen.has(nameNode.from)) return;
      const label = doc.sliceString(nameNode.from, nameNode.to).trim();
      if (!label) return;
      seen.add(nameNode.from);
      symbols.push({
        label,
        kind,
        from: nameNode.from,
        line: doc.lineAt(nameNode.from).number,
      });
      // 跳过子树：函数/类内部的定义（参数/局部变量）不重复收集
      return false;
    },
  });

  return symbols;
}

/** 在节点直接子级中找第一个「名字型」子节点（@lezer/common getChild 仅接受 string/number，故手遍历） */
function findNameChild(node: SyntaxNode): SyntaxNode | null {
  for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
    if (NAME_NODE_RE.test(ch.name)) return ch;
  }
  return null;
}
