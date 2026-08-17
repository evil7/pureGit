/**
 * 媒体预览（图片/音频/视频）—— 自 BlobPage 拆出。
 * 加载中显示占位，失败显示错误提示；svg 不进入（走代码渲染确保安全）。
 */
import { useState } from "react";
import { useI18n } from "@/i18n";
import { InlineError } from "@/components/InlineError";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MediaKind } from "@/lib/repo/media-type";

export function MediaPreview({ kind, src, alt }: { kind: MediaKind; src: string; alt: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");

  if (state === "error") {
    return <InlineError message={t("blob.mediaLoadError")} size="sm" />;
  }
  if (kind === "image") {
    return (
      <div className="flex w-full items-center justify-center">
        {/* 图片加载完成前 Skeleton 占位（避免空白不知在加载）；加载后隐藏占位显示图片 */}
        {state === "loading" && <Skeleton className="h-64 w-full max-w-2xl" />}
        <img
          src={src}
          alt={alt}
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          className={cn("max-h-[70vh] max-w-full object-contain", state !== "loaded" && "hidden")}
        />
      </div>
    );
  }
  // 音频/视频：原生控件自带缓冲指示，仅需失败兜底
  return kind === "audio" ? (
    <audio controls src={src} className="w-full" onError={() => setState("error")} />
  ) : (
    <video
      controls
      src={src}
      className="max-h-[70vh] max-w-full"
      onError={() => setState("error")}
    />
  );
}
