/**
 * ============================================================================
 * markdown-plugins 单元测试 —— GitHub 风格 Markdown 语法注入质量门
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * MarkdownView 依赖 @uiw/react-markdown-preview（第三方渲染），其**二次定义核心**
 * 是 markdown-plugins 的 GitHub 特有语法注入（remark AST 层）：
 * - githubSyntax 插件：`@user` → 链接 /user；`#123` → 链接 /issues/123；`:tada:` → g-emoji
 * - 边界：邮箱内的 @ 跳过（foo@bar.com 不转）、链接文本内跳过（父节点 link/html）、
 *   mentions=false 禁用 @mention、未知 emoji shortcode 保持文本
 * - parseRepoFromRawBase：从 raw 基 URL 提取 owner/repo
 *
 * 【测试方式】构造最小 mdast 树，直接执行插件转换并断言 AST 结构（纯 AST 操作，
 * 无 DOM/网络依赖，node 环境可测）。
 */
import { describe, it, expect } from "vitest";
import { githubSyntax, parseRepoFromRawBase } from "@/lib/markdown/markdown-plugins";
import type { Root } from "mdast";

/** 便捷构造单文本节点树 */
function textTree(value: string, parentType = "paragraph"): Root {
  return {
    type: "root",
    children: [{ type: parentType, children: [{ type: "text", value }] }],
  } as Root;
}

/** 执行插件并返回 paragraph 的 children（githubSyntax 为 unified 插件：工厂 → 插件 → transformer） */
function run(text: string, opts: { owner?: string; repo?: string; mentions?: boolean } = {}) {
  const tree = textTree(text);
  const transformer = githubSyntax({
    owner: opts.owner ?? "evil7",
    repo: opts.repo ?? "puregit",
    mentions: opts.mentions,
  })();
  transformer(tree);
  const p = tree.children[0] as { children: unknown[] };
  return p.children;
}

describe("parseRepoFromRawBase", () => {
  it("raw 基 URL → 提取 owner/repo", () => {
    expect(parseRepoFromRawBase("https://raw.githubusercontent.com/evil7/puregit/main/")).toEqual({
      owner: "evil7",
      repo: "puregit",
    });
  });

  it("非 raw 域名 / undefined → 空对象", () => {
    expect(parseRepoFromRawBase("https://example.com/x")).toEqual({});
    expect(parseRepoFromRawBase(undefined)).toEqual({});
    expect(parseRepoFromRawBase("")).toEqual({});
  });
});

describe("githubSyntax 插件", () => {
  it("@mention → 链接 /user（文本 + 链接节点）", () => {
    const children = run("Hi @alice!");
    // 期望: text("Hi "), link(@alice), text("!")
    expect(children).toEqual([
      { type: "text", value: "Hi " },
      { type: "link", url: "/alice", children: [{ type: "text", value: "@alice" }] },
      { type: "text", value: "!" },
    ]);
  });

  it("#issue → 链接 /issues/N（data.issueRef）", () => {
    const children = run("Fixes #42");
    // 正则 (?:^|\s)(#(\d+)) 会消耗 # 前的空格 → 前置文本无尾随空格
    expect(children[0]).toEqual({ type: "text", value: "Fixes" });
    expect(children[1]).toEqual({
      type: "link",
      url: "/issues/42",
      children: [{ type: "text", value: "#42", data: { issueRef: true } }],
    });
  });

  it(":emoji: → g-emoji html 节点（保留 alias）", () => {
    const children = run("Party :tada:");
    expect(children[1]).toEqual({
      type: "html",
      value: `<g-emoji class="g-emoji" alias="tada">🎉</g-emoji>`,
    });
  });

  it("混合：@mention + #issue + emoji 同时转换（emoji 前空格为独立 text）", () => {
    const children = run("@alice #42 :rocket:");
    // mention + issue + text(" ") + emoji = 4 个节点（emoji 前空格因 \s 消耗成为独立文本段）
    expect(children).toHaveLength(4);
    expect(children[0]).toMatchObject({ type: "link", url: "/alice" });
    expect(children[1]).toMatchObject({ type: "link", url: "/issues/42" });
    expect(children[2]).toEqual({ type: "text", value: " " });
    expect(children[3]).toMatchObject({ type: "html" });
  });

  it("无匹配 → 原样单文本节点", () => {
    const children = run("plain text no syntax");
    expect(children).toEqual([{ type: "text", value: "plain text no syntax" }]);
  });

  it("邮箱内 @ 跳过（foo@bar.com 不转 @bar）", () => {
    const children = run("contact foo@bar.com now");
    // 无 link 节点（@bar 是邮箱一部分）
    expect(children).toEqual([{ type: "text", value: "contact foo@bar.com now" }]);
  });

  it("链接文本内（父节点 link）不解析", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://x.com/@alice",
              children: [{ type: "text", value: "@alice" }],
            },
          ],
        },
      ],
    } as Root;
    const transformer = githubSyntax({ owner: "evil7", repo: "puregit" })();
    transformer(tree);
    const p = tree.children[0] as { children: unknown[] };
    // 链接内的 text 不被替换（保持单一 text 节点）
    expect(p.children).toHaveLength(1);
    expect(p.children[0]).toMatchObject({ type: "link" });
  });

  it("mentions=false → @mention 跳过，仅剩 1 个有效 segment → 整段保守不转换", () => {
    // 实现语义：@mention 被跳过（mentions=false）后 #42 是唯一 segment →
    // segments.length===1 短路 → 整段保持原文（保守不产生部分转换）
    const children = run("@alice #42", { mentions: false });
    expect(children).toEqual([{ type: "text", value: "@alice #42" }]);
  });

  it("未知 emoji shortcode → 保持文本（拆为相邻 text 节点，不产出 html）", () => {
    const children = run("weird :not_a_real_emoji_x:");
    // 未知 emoji 作为 text segment 保留；与前置文本分成两个 text 节点（语义不变）
    expect(children).toEqual([
      { type: "text", value: "weird " },
      { type: "text", value: ":not_a_real_emoji_x:" },
    ]);
  });

  it("纯文本节点无匹配 → 插件不修改（segments.length===1 短路）", () => {
    const children = run("hello");
    expect(children).toEqual([{ type: "text", value: "hello" }]);
  });
});
