/**
 * Markdown 渲染（GitHub 风格 换用成品库 @uiw/react-markdown-preview）
 *
 * 原自研官方 DOM 复刻（markdown-heading/anchor/highlight/复制按钮/任务列表等）维护成本高、
 * 与库版本迭代耦合，改为直接使用**成熟成品渲染库**：
 * - `@uiw/react-markdown-preview`：GitHub 风格渲染（标题锚点/表格/引用/代码高亮+复制/任务列表/
 *   GitHub Alerts/深色模式），一个组件开箱即用，无需手写官方 DOM 适配
 * - 保留 GitHub 特有语法（issue/PR 刚需）：@mention / #issue 引用 / :emoji:（githubSyntax remark 插件）
 * - 相对路径资源解析（README 图片 → rawBase、相对链接 → github blob 页）由 urlTransform 完成
 *
 * 安全：urlTransform 协议白名单（javascript: 等拦截）+ components 丢弃 script/style/iframe/object/embed；
 * 深色模式经 wrapperElement[data-color-mode] 跟随站点主题（useIsDark）。
 *
 * 标题 id：库 rehype-slug 按 GitHub slugger 规则生成（与 outline 面板 extractOutline 规则一致，
 * blob 页 Outline 面板点击滚动依赖 h[id]，scroll-margin 见 custom.css）。
 *
 * 代码块复制：库自带复制按钮（octicon 图标 + prettylights 语法色）与站点主题不符，
 * 用 disableCopy 禁掉，components.pre 注入与操作栏一致的 lucide 复制按钮（chart-1 蓝 √）。
 *
 * oxlint 豁免：components 内联对象由库 API 强制要求（需闭包访问 owner/repo/rawBase/isDark 等），
 * 无法提升为模块级组件，no-unstable-nested-components 属误报，统一豁免。
 */
/* eslint-disable react/no-unstable-nested-components -- 库 components API 强制内联，需闭包访问渲染上下文 */
import { useState, type ComponentProps, type ReactNode } from "react";
import MarkdownPreview from "@uiw/react-markdown-preview";
import { Check, Copy } from "lucide-react";
import { githubSyntax, parseRepoFromRawBase } from "@/lib/markdown-plugins";
import { rawImgFallbackSrc } from "@/lib/raw-proxy";
import { useIsDark } from "@/hooks/useIsDark";
import type { OutlineItem } from "@/lib/markdown-outline";

/** 从 pre 子节点递归提取纯文本（复制内容 = 代码原文，去高亮 span 包装） */
function extractCodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractCodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** 代码块（pre）——库默认复制按钮改注入与操作栏一致的 lucide 按钮（hover 显示，点击 chart-1 √） */
function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = extractCodeText(children);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <pre {...props} className="group relative">
      {children}
      <button
        type="button"
        onClick={doCopy}
        title={copied ? "已复制" : "复制代码"}
        aria-label={copied ? "已复制" : "复制代码"}
        className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        {copied ? <Check className="size-3.5 text-chart-1" /> : <Copy className="size-3.5" />}
      </button>
    </pre>
  );
}

/** 相对路径 → 绝对 URL（src 图片走 raw；href 链接走 github.com 页面，blob 指向目录自动跳 tree） */
function resolveRelativeUrl(url: string, key: string, rawBase?: string): string {
  if (!rawBase || (key !== "src" && key !== "href")) return url;
  // 去除 ./ 与前导 /（/CONTRIBUTING.md 是仓库根相对写法）
  const p = url.replace(/^\.?\//, "");
  if (key === "src") return `${rawBase}/${p}`;
  // rawBase 形如 https://raw.githubusercontent.com/{owner}/{repo}/{branch}[/dir]
  // → https://github.com/{owner}/{repo}/blob/{branch}/{dir}/{p}
  const m = rawBase.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(.+))?$/,
  );
  if (!m) return url;
  // 目录可能为空（根目录）→ 避免 blob/{branch}//{p} 双斜杠
  const dir = m[4] ? `${m[4]}/` : "";
  return `https://github.com/${m[1]}/${m[2]}/blob/${m[3]}/${dir}${p}`;
}

/** URL 安全转换：协议白名单 + 相对路径解析 */
function safeUrlTransform(url: string, key: string, rawBase?: string): string {
  const value = url.trim();
  if (!value) return value;
  // 白名单协议（与 react-markdown defaultUrlTransform 一致）
  if (/^(https?|irc|ircs|mailto|xmpp):/i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (value.startsWith("#")) return value;
  // 站内路由（@mention / #issue 生成的 /user、/issues/N 等）→ 保持相对路径
  if (/^\/([^/]+\/)?(issues|pulls|blob|tree)\//.test(value)) return value;
  // 单段用户路由（/user）；带文件扩展名的单段路径（/CONTRIBUTING.md）→ 走相对解析
  if (/^\/[^/.]+$/.test(value)) return value;
  // 其余协议（javascript:/vbscript:/data:text 等）→ 拦截防 XSS
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
  // 相对路径（./x、x、../x）→ 依 key 解析
  return resolveRelativeUrl(value, key, rawBase);
}

/**
 * GitHub 风格 Markdown 渲染组件（成品库 @uiw/react-markdown-preview 封装）。
 * @param rawBase 相对资源解析基准（README 传其所在目录 raw base；issue/PR/评论传 repoRawBase(owner, repo)）；
 *                缺省时相对路径原样输出（不做解析）。
 * @param headings 兼容外部 outline（标题 id 由库 rehype-slug 按 GitHub slugger 规则生成，
 *                与 outline 面板 extractOutline 规则一致）。
 */
export function MarkdownView({
  children,
  rawBase,
  headings,
}: {
  children: string;
  rawBase?: string;
  headings?: OutlineItem[];
}) {
  const { owner, repo } = parseRepoFromRawBase(rawBase);
  const isDark = useIsDark();
  void headings; // 兼容外部 outline（标题 id 由库生成，规则一致）

  return (
    <MarkdownPreview
      source={children}
      urlTransform={(url, key) => safeUrlTransform(url, key, rawBase)}
      remarkPlugins={[githubSyntax({ owner, repo })]}
      disableCopy
      wrapperElement={{ "data-color-mode": isDark ? "dark" : "light" }}
      components={{
        pre: CodeBlock,
        // 表格单元格：库底层 rehype 给 <td>/<th> 传废弃 vAlign prop →
        // React 19 不识别报 console 警告（匿名访问含表格 README 时出现）。运行时删除该键，
        // 其余透传（对齐样式库内已用 CSS 处理，vAlign 无实际作用）。
        td: (props) => {
          const rest = { ...props };
          delete (rest as Record<string, unknown>).vAlign;
          return <td {...rest} />;
        },
        th: (props) => {
          const rest = { ...props };
          delete (rest as Record<string, unknown>).vAlign;
          return <th {...rest} />;
        },
        // 图片：raw 直连（rawBase）失败（被墙/CORS）→ onError 自动降级 /$raw 代理重试一次
        img: ({ src, alt, ...props }) => {
          const isRawSrc = typeof src === "string" && src.includes("raw.githubusercontent.com");
          if (!isRawSrc) {
            return <img src={src} alt={alt} {...props} />;
          }
          return (
            <img
              src={src}
              alt={alt}
              {...props}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.fallback) return; // 已重试过一次，防止循环
                const proxy = rawImgFallbackSrc(el.src);
                if (proxy !== el.src) {
                  el.dataset.fallback = "1";
                  el.src = proxy;
                }
              }}
            />
          );
        },
        // 危险标签直接丢弃（script/style/iframe/object/embed 无渲染价值且防 XSS）
        script: () => null,
        style: () => null,
        iframe: () => null,
        object: () => null,
        embed: () => null,
        // 链接：外部（站外 http）→ target=_blank + rel noopener noreferrer nofollow；
        // @mention / #issue（githubSyntax 生成）→ 官方同款样式
        a: ({ href, children: aChildren, ...props }) => {
          const isExternal =
            !!href && /^https?:\/\//.test(href) && !href.startsWith("https://github.com/");
          if (isExternal) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
                {aChildren}
              </a>
            );
          }
          const isMention = typeof aChildren === "string" && aChildren.startsWith("@");
          const isIssue = typeof aChildren === "string" && /^#\d+$/.test(aChildren);
          if (isMention) {
            return (
              <a href={href} className="font-medium text-primary hover:underline" {...props}>
                {aChildren}
              </a>
            );
          }
          if (isIssue) {
            return (
              <a
                href={href}
                className="issue-link font-medium text-primary hover:underline"
                {...props}
              >
                {aChildren}
              </a>
            );
          }
          return (
            <a href={href} {...props}>
              {aChildren}
            </a>
          );
        },
      }}
    />
  );
}
