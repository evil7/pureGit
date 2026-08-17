/**
 * GitHub 官方 web components 的 JSX 类型声明
 *
 * 覆盖 @github/markdown-toolbar-element（md-* 按钮 + markdown-toolbar）与
 * @github/text-expander-element（text-expander）。包的 d.ts 只声明了
 * HTMLElementTagNameMap（DOM API 用），React JSX.IntrinsicElements 不认 → 需显式增强。
 *
 * React 19 原生支持自定义元素：属性 → attribute/property，onXxx → 事件监听。
 */
import type * as React from "react";

type GithubElProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** 工具栏容器（md-* 按钮父级；for 关联 textarea） */
      "markdown-toolbar": GithubElProps & { for?: string };
      "md-header": GithubElProps;
      "md-bold": GithubElProps;
      "md-italic": GithubElProps;
      "md-strikethrough": GithubElProps;
      "md-quote": GithubElProps;
      "md-code": GithubElProps;
      "md-link": GithubElProps;
      "md-image": GithubElProps;
      "md-unordered-list": GithubElProps;
      "md-ordered-list": GithubElProps;
      "md-task-list": GithubElProps;
      "md-mention": GithubElProps;
      "md-ref": GithubElProps;
      /** @/#/: 补全容器（keys=": @ #"） */
      "text-expander": GithubElProps & { keys?: string };
    }
  }
}
