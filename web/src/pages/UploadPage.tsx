/**
 * 文件上传页（/:owner/:repo/upload/:branch/*，官方 Upload files 页复刻）
 *
 * 官方结构：标题「Upload files to {owner}/{repo}」+ 拖拽/选择文件区 + 待上传文件列表
 * （名称/大小/移除）+ commit 区（commit message + Direct commit / 新建分支 PR）。
 *
 * 数据通道：uploadFiles（git data API 四步：blobs → tree → commit → ref，二进制安全，
 * 多文件一次 commit）；新建分支复用 createBranch 两段式。单文件上限 25MB（对齐官方网页上传）。
 */
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Upload, X, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { InlineError } from "@/components/InlineError";
import { NeedFork } from "@/components/NeedFork";
import { useAuth } from "@/hooks/useAuth";
import { useRepoPermission } from "@/hooks/useRepoPermission";
import { useI18n } from "@/i18n";
import { uploadFiles, createBranch, apiErrorMessage } from "@/lib/restapi";
import { PAGE_SHELL } from "@/lib/ui/layout";
import { cn } from "@/lib/utils";

/** 单文件上限：25MB（对齐官方网页上传限制；git blobs API 上限 100MB，但网页 UI 限 25MB） */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** 待上传文件（name 原始文件名；base64 已剥离 data URL 前缀） */
interface UploadItem {
  name: string;
  size: number;
  base64: string;
}

/** File → base64（去 data URL 前缀；二进制安全） */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 人类可读文件大小 */
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPage() {
  const { owner = "", repo = "", branch = "", "*": rest = "" } = useParams();
  const { token, user } = useAuth();
  const { canWrite: canWriteRepo } = useRepoPermission();
  const { t } = useI18n();
  const navigate = useNavigate();
  // 上传目标目录前缀（rest 为目录路径，可为空 = 仓库根）
  const dirPrefix = rest;

  const [files, setFiles] = useState<UploadItem[]>([]);
  const [commitMessage, setCommitMessage] = useState("Add files via upload");
  const [commitMode, setCommitMode] = useState<"direct" | "pr">("direct");
  const defaultNewBranch = `${user?.login ?? owner}-patch-1`;
  const [newBranch, setNewBranch] = useState(defaultNewBranch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 读取并追加所选文件（超限跳过并提示） */
  const addFiles = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    const next: UploadItem[] = [];
    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) {
        setError(t("upload.tooLarge").replace("{name}", f.name));
        continue;
      }
      try {
        const base64 = await readAsBase64(f);
        next.push({ name: f.name, size: f.size, base64 });
      } catch {
        setError(t("upload.readFailed").replace("{name}", f.name));
      }
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!token || busy || files.length === 0 || !commitMessage.trim()) return;
    // 新建分支名：pr 模式且输入非空 → 分支名；否则 null（direct 提交到当前分支）
    const useNewBranch: string | null =
      commitMode === "pr" && newBranch.trim() ? newBranch.trim() : null;
    setBusy(true);
    setError(null);
    try {
      if (useNewBranch) {
        // 官方两段式：先建分支，再提交到新分支
        await createBranch(owner, repo, useNewBranch, branch, token);
      }
      const targetBranch = useNewBranch ?? branch;
      await uploadFiles(
        owner,
        repo,
        targetBranch,
        files.map((f) => ({
          path: dirPrefix ? `${dirPrefix}/${f.name}` : f.name,
          content: f.base64,
        })),
        commitMessage.trim(),
        token,
      );
      // 跳转到上传目标目录（direct → 原分支；新建分支 → 新分支）
      navigate(`/${owner}/${repo}/tree/${targetBranch}${dirPrefix ? `/${dirPrefix}` : ""}`);
    } catch (e) {
      setError(
        apiErrorMessage(
          e,
          useNewBranch
            ? t("upload.branchExists").replace("{branch}", useNewBranch)
            : t("upload.failed"),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  // 仓库归属判断：无仓库写权限（WRITE 以下）→ fork 引导（对齐 FileEditorPage）
  const isOwnRepo = !token || canWriteRepo;

  if (!isOwnRepo) {
    return (
      <div className={PAGE_SHELL}>
        <NeedFork owner={owner} action={t("common.upload")} />
      </div>
    );
  }

  const canSubmit = token && files.length > 0 && commitMessage.trim();

  return (
    <div className={PAGE_SHELL}>
      {/* 标题（官方 Upload files to {owner}/{repo}） */}
      <h1 className="mb-1 text-xl font-semibold">
        {t("upload.title")} {owner}/{repo}
      </h1>
      {dirPrefix && (
        <p className="mb-4 text-sm text-muted-foreground">
          {t("upload.toDir").replace("{dir}", dirPrefix)}
        </p>
      )}

      {/* 拖拽/选择文件区（官方 drag zone） */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Upload className="size-6 text-muted-foreground" />
        <p className="text-sm">
          {t("upload.dragHint")}{" "}
          <span className="font-medium text-primary hover:underline">{t("upload.choose")}</span>
        </p>
        <p className="text-xs text-muted-foreground">{t("upload.limit")}</p>
      </div>

      {/* 待上传文件列表（官方：每行 name + size + 移除） */}
      {files.length > 0 && (
        <Card className="mb-4">
          <CardContent className="p-0">
            <ul className="divide-y">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <FileIcon className="size-4 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t("common.remove")}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* commit 区（官方：commit message + Direct commit / 新建分支 PR + 提交按钮） */}
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="upload-commit-message">{t("upload.commitMessage")}</Label>
            <Textarea
              id="upload-commit-message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={t("upload.commitPlaceholder")}
              rows={3}
            />
          </div>

          <RadioGroup
            value={commitMode}
            onValueChange={(v) => setCommitMode(v as "direct" | "pr")}
            className="grid gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="direct" id="upload-direct" />
              <Label htmlFor="upload-direct" className="text-sm font-normal">
                {t("upload.directCommit").replace("{branch}", branch)}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="pr" id="upload-pr" />
              <Label htmlFor="upload-pr" className="text-sm font-normal">
                {t("upload.newBranchPr")}
              </Label>
            </div>
          </RadioGroup>

          {commitMode === "pr" && (
            <div className="grid gap-1.5">
              <Label htmlFor="upload-new-branch">{t("upload.newBranchLabel")}</Label>
              <Input
                id="upload-new-branch"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder={t("upload.newBranchPlaceholder")}
              />
            </div>
          )}

          {error && <InlineError message={error} />}

          <div className="flex items-center gap-2">
            <Button disabled={!canSubmit || busy} onClick={() => void submit()}>
              {busy ? t("common.committing") : t("upload.commit")}
            </Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              {t("common.cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
