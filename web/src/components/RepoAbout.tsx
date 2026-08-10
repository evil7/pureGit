/**
 * 仓库 About 侧栏（官方 2026-08 新版结构重构）
 *
 * 官方 pane 内「分区平铺」（SidebarSection，无卡片边框），本项目与 Issue 详情右栏
 * section 风格一致（space-y-5 + h3 小标题）。分区顺序对齐官方：
 *   About（描述/网站/topics/Resources/统计）→ Releases（最新 release 入口）→
 *   Packages → Contributors → Languages
 *
 * 数据源：
 *   - Repository + languages（fetchRepositorySmart）
 *   - 最新 release + 总数（fetchLatestReleaseSmart：GraphQL totalCount+nodes(first:1) 首选 / REST per_page=1）
 *   - contributors 计数（fetchContributorsCount）
 *   - 根目录文件探测（fetchRootFiles，驱动 Resources 中 CoC/Contributing/Security/license 显示）
 *
 * 注意：Star/Fork 操作按钮位于 RepoHeader 仓库名行右侧（官方位置），不在本栏。
 */
import {
  BookOpen,
  Eye,
  Flag,
  GitFork,
  Globe,
  HeartHandshake,
  Package,
  Scale,
  ShieldCheck,
  Star,
  Tag,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { LangColorBar } from "@/components/LangColorBar";
import { useDateFormat } from "@/hooks/useDateFormat";
import { formatCount } from "@/lib/format";
import type { Release, Repository } from "@/lib/rest";

/** 官方 TopicTag pill 样式（浅底蓝字圆角） */
const TOPIC_TAG =
  "rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15";

/** Resources 根文件探测集合（官方规则简化：根目录常见文件名，小写匹配） */
const RESOURCE_FILES = {
  coc: ["code_of_conduct.md", "code_of_conduct.txt", "code_of_conduct"],
  contributing: ["contributing.md", "contributing.txt", "contributing"],
  security: ["security.md", "security.txt", "security"],
  license: [
    "license.md",
    "license.txt",
    "license.rst",
    "license",
    "copying.md",
    "copying.txt",
    "copying",
    "unlicense",
    "unlicense.md",
    "unlicense.txt",
  ],
} as const;

export default function RepoAbout({
  data,
  languages,
  releasesCount,
  latestRelease,
  contributorsCount,
  rootFiles,
}: {
  data: Repository;
  languages: Record<string, number>;
  releasesCount: number;
  /** 最新 release（官方侧栏 Releases 分区入口；无 release 时 null） */
  latestRelease: Release | null;
  contributorsCount: number;
  /** 仓库根目录文件名（保留原始大小写；null = 探测失败，非必须项隐藏） */
  rootFiles: string[] | null;
}) {
  const { fmt } = useDateFormat();

  const fullName = `${data.owner.login}/${data.name}`;
  const branch = data.default_branch;
  const officialUrl = `https://github.com/${fullName}`;
  // 探测（小写匹配）返回原始文件名，用于 blob 链接（路由大小写敏感）
  const findFile = (names: readonly string[]) =>
    rootFiles?.find((f) => names.includes(f.toLowerCase()));

  // Resources 链接（官方：文件存在于仓库根目录才显示；Readme 总显示——根页即渲染 README）
  const cocFile = findFile(RESOURCE_FILES.coc);
  const contributingFile = findFile(RESOURCE_FILES.contributing);
  const securityFile = findFile(RESOURCE_FILES.security);
  const licenseFile = findFile(RESOURCE_FILES.license);
  const resources: { icon: ComponentType<{ className?: string }>; label: string; href: string }[] =
    [{ icon: BookOpen, label: "Readme", href: `/${fullName}` }];
  if (data.license?.spdx_id) {
    resources.push({
      icon: Scale,
      label: `${data.license.spdx_id} license`,
      href: `/${fullName}/blob/${branch}/${licenseFile ?? "LICENSE"}`,
    });
  }
  if (cocFile) {
    resources.push({
      icon: HeartHandshake,
      label: "Code of conduct",
      href: `/${fullName}/blob/${branch}/${cocFile}`,
    });
  }
  if (contributingFile) {
    resources.push({
      icon: Users,
      label: "Contributing",
      href: `/${fullName}/blob/${branch}/${contributingFile}`,
    });
  }
  if (securityFile) {
    resources.push({
      icon: ShieldCheck,
      label: "Security policy",
      href: `/${fullName}/blob/${branch}/${securityFile}`,
    });
  }

  return (
    <div className="space-y-5 text-sm">
      {/* ===== About ===== */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">About</h3>

        {data.description && <p className="mb-2 text-muted-foreground">{data.description}</p>}

        {data.homepage && (
          <a
            href={data.homepage}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex min-w-0 items-center gap-1.5 text-primary hover:underline"
          >
            <Globe className="size-4 shrink-0" />
            <span className="truncate">{data.homepage}</span>
          </a>
        )}

        {data.topics && data.topics.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {data.topics.slice(0, 8).map((topic) => (
              <a
                key={topic}
                href={`https://github.com/topics/${encodeURIComponent(topic)}`}
                target="_blank"
                rel="noreferrer"
                className={TOPIC_TAG}
              >
                {topic}
              </a>
            ))}
          </div>
        )}

        {/* Resources（官方：README/LICENSE/CoC/Contributing/Security 根文件链接） */}
        {resources.length > 0 && (
          <div className="space-y-1.5 border-t pt-3">
            {resources.map(({ icon: Icon, label, href }) => (
              <Link
                key={label}
                to={href}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-primary"
              >
                <Icon className="size-3.5 shrink-0" />
                {label}
              </Link>
            ))}
          </div>
        )}

        {/* 统计（官方纵向：stars / watching / forks） */}
        <div className="mt-3 space-y-1.5 border-t pt-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Star className="size-3.5 shrink-0" />
            <strong className="text-foreground">{formatCount(data.stargazers_count)}</strong>
            stars
          </span>
          <span className="flex items-center gap-1.5">
            <Eye className="size-3.5 shrink-0" />
            <strong className="text-foreground">{formatCount(data.subscribers_count ?? 0)}</strong>
            watching
          </span>
          <span className="flex items-center gap-1.5">
            <GitFork className="size-3.5 shrink-0" />
            <strong className="text-foreground">{formatCount(data.forks_count)}</strong>
            forks
          </span>
        </div>

        {/* Report repository（官方：无内部对应页，链官方举报入口） */}
        <a
          href={`https://github.com/contact/report-content?content_url=${encodeURIComponent(officialUrl)}&report=${encodeURIComponent(fullName)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-1.5 border-t pt-3 text-muted-foreground hover:text-primary"
        >
          <Flag className="size-3.5 shrink-0" />
          Report repository
        </a>
      </section>

      {/* ===== Releases（官方分区：最新 release 实体入口；header tab 保留共存） ===== */}
      <section>
        <h3 className="mb-2 flex items-baseline gap-1.5 text-sm font-semibold">
          <Link to={`/${fullName}/releases`} className="hover:text-primary">
            Releases
          </Link>
          {releasesCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {formatCount(releasesCount)}
            </span>
          )}
        </h3>
        {latestRelease ? (
          <div>
            <Link
              to={`/${fullName}/releases`}
              className="flex items-start gap-2 rounded-md p-2 transition-colors hover:bg-accent/60"
            >
              <Tag className="mt-0.5 size-4 shrink-0 text-green-600" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{latestRelease.tag_name}</span>
                  {!latestRelease.draft && (
                    <Badge className="bg-green-600 text-white">Latest</Badge>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {fmt(latestRelease.published_at)}
                </span>
              </span>
            </Link>
            {releasesCount > 1 && (
              <div className="mt-0.5 px-2 text-xs">
                <Link
                  to={`/${fullName}/releases`}
                  className="text-muted-foreground hover:text-primary hover:underline"
                >
                  + {releasesCount - 1} releases
                </Link>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">No releases published</p>
        )}
      </section>

      {/* ===== Packages（官方：无 packages 发布则占位；链官方 packages 页） ===== */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Packages</h3>
        <a
          href={`${officialUrl}/packages`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-primary"
        >
          <Package className="size-3.5 shrink-0" />
          No packages published
        </a>
      </section>

      {/* ===== Contributors（计数行；官方头像网格未做——省一次请求） ===== */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">
          <a
            href={`${officialUrl}/graphs/contributors`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary"
          >
            Contributors
          </a>
        </h3>
        <a
          href={`${officialUrl}/graphs/contributors`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-primary"
        >
          <Users className="size-3.5 shrink-0" />
          {contributorsCount > 0
            ? `${formatCount(contributorsCount)} contributors`
            : "No contributors"}
        </a>
      </section>

      {/* ===== Languages（官方：进度条 + 语言列表；搜索页暂不支持 l= 过滤，保持图例） ===== */}
      {/* 配色独立方案：LangColorBar 内联 style + linguist 官方色表，不碰 chart 类 */}
      {Object.keys(languages).length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Languages</h3>
          <LangColorBar languages={languages} />
        </section>
      )}
    </div>
  );
}
