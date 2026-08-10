/**
 * GitHub 风格 Markdown 语法插件（换成品库后精简）
 *
 * 在 remark 抽象语法树层注入 GitHub 特有语法（issue/PR 刚需，成品库不内置）：
 * - @mention：`@user` → 链接 /user（排除邮箱、代码块、链接内文本）
 * - #issue 引用：`#123` → 链接 /owner/repo/issues/123（同仓库）
 * - emoji：`:tada:` → g-emoji 元素（保留 alias，与官方一致）
 *
 * （GitHub Alerts 由 @uiw/react-markdown-preview 内置 remark-github-blockquote-alert 处理，此处不再重复。）
 *
 * 使用：remarkPlugins={[githubSyntax({ owner, repo })]}
 */
import { visit } from "unist-util-visit";
import { get as emojiGet } from "node-emoji";
import type { Root, Text } from "mdast";

/** emoji shortcode → unicode（node-emoji 的 get，接受 :tada: 或 tada） */
function emojiUnicode(code: string): string | undefined {
  try {
    return emojiGet(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 提取 rawBase 中的 owner/repo（raw.githubusercontent.com/{owner}/{repo}/...） */
export function parseRepoFromRawBase(rawBase?: string): {
  owner?: string;
  repo?: string;
} {
  const m = rawBase?.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/);
  return m ? { owner: m[1], repo: m[2] } : {};
}

/** GitHub 语法插件工厂 */
export function githubSyntax(opts: {
  owner?: string;
  repo?: string;
  /** 禁用 @mention 链接（如纯技术文档可能误判） */
  mentions?: boolean;
}) {
  const { owner, repo, mentions = true } = opts;

  return () => (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!node.value || index === undefined || !parent) return;

      // 跳过父节点为链接的场景（链接文本内不再解析）
      const pType = (parent as { type?: string }).type;
      if (pType === "link" || pType === "html") return;

      const segments = splitSyntax(node.value, { owner, repo, mentions });
      if (segments.length === 1) return; // 无匹配

      // 替换 text 节点为多个节点（text/link/html 混合）
      const children = segments.map((seg) => {
        if (seg.type === "text") return { type: "text", value: seg.value } as Text;
        if (seg.type === "mention") {
          return {
            type: "link",
            url: `/${seg.user}`,
            children: [{ type: "text", value: `@${seg.user}` }],
          };
        }
        if (seg.type === "issue") {
          const url = `/issues/${seg.number}`;
          return {
            type: "link",
            url,
            children: [
              {
                type: "text",
                value: `#${seg.number}`,
                data: { issueRef: true },
              },
            ],
          };
        }
        // emoji → html 节点（g-emoji，保留 alias）
        return {
          type: "html",
          value: `<g-emoji class="g-emoji" alias="${seg.alias}">${seg.emoji}</g-emoji>`,
        };
      });

      (parent as { children: unknown[] }).children.splice(index, 1, ...children);
    });
  };
}

type Segment =
  | { type: "text"; value: string }
  | { type: "mention"; user: string }
  | { type: "issue"; number: string }
  | { type: "emoji"; alias: string; emoji: string };

/** 拆分文本节点为 GitHub 语法段（@/#/:） */
function splitSyntax(
  text: string,
  opts: { owner?: string; repo?: string; mentions: boolean },
): Segment[] {
  const segments: Segment[] = [];
  let rest = text;
  // 组合正则：@mention | #issue | :emoji:
  const re = /(@[\w][\w-]*)|(?:^|\s)(#(\d+))|(:\w+:)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const [full, mention, , issueNum, emojiCode] = m;
    // 跳过邮箱（@ 前是字符时）
    if (mention) {
      const before = rest.slice(last, m.index);
      // 邮箱检测：前面是 word 或 . 字符 → 非 @mention（如 foo@bar.com 的 @bar）
      if (/[\w.+-]$/.test(before) && !/[\s([{]$/.test(before)) {
        last = m.index + full.length;
        continue;
      }
      if (!opts.mentions) {
        last = m.index + full.length;
        continue;
      }
    }
    if (m.index > last) {
      segments.push({ type: "text", value: rest.slice(last, m.index) });
    }
    if (mention) {
      segments.push({ type: "mention", user: mention.slice(1) });
    } else if (issueNum) {
      segments.push({ type: "issue", number: issueNum });
    } else if (emojiCode) {
      const alias = emojiCode.slice(1, -1);
      const emoji = emojiUnicode(emojiCode);
      if (emoji) {
        segments.push({ type: "emoji", alias, emoji });
      } else {
        segments.push({ type: "text", value: emojiCode });
      }
    }
    last = m.index + full.length;
  }
  if (last < rest.length) {
    segments.push({ type: "text", value: rest.slice(last) });
  }
  return segments;
}
