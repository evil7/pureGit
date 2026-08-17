import { Link } from "react-router-dom";
import { Star, GitFork, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LangDot } from "@/components/LangDot";
import { RepoVisibilityBadge } from "@/components/RepoVisibilityBadge";
import { useI18n } from "@/i18n";
import { formatCount } from "@/lib/ui/format";
import type { Repository } from "@/lib/restapi";

export function RepositoryCard({ repo }: { repo: Repository }) {
  const { t } = useI18n();
  // fork 仓库图标区分（官方：自建 BookOpen / fork GitFork）
  const Icon = repo.fork ? GitFork : BookOpen;
  return (
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <Link
            to={`/${repo.full_name}`}
            className="min-w-0 flex-1 truncate font-semibold text-primary hover:underline"
            title={repo.full_name}
          >
            {repo.full_name}
          </Link>
          {/* 状态徽章（私有/归档；公开不显示） */}
          <RepoVisibilityBadge repo={repo} />
        </div>

        {/* fork 来源（官方 "forked from X"） */}
        {repo.fork && repo.parent?.full_name && (
          <p className="text-xs text-muted-foreground">
            {t("forkInfo.forkedFrom").replace("{name}", repo.parent.full_name)}
          </p>
        )}

        {repo.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{repo.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {repo.language && (
            <span className="flex items-center gap-1">
              <LangDot lang={repo.language} />
              {repo.language}
            </span>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Star className="size-3.5" />
            {formatCount(repo.stargazers_count)}
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <GitFork className="size-3.5" />
            {formatCount(repo.forks_count)}
          </span>
        </div>

        {repo.topics && repo.topics.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {repo.topics.slice(0, 3).map((topic) => (
              <Badge key={topic} variant="secondary" className="text-xs">
                {topic}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
