/**
 * 登录权限选择对话框（权限分级：仅读写二档）
 *
 * 入口：导航栏「登录」按钮 / 写操作未登录引导。
 * 逻辑：
 * - [只读模式 / 完全控制] 分段控件（同偏好设置主题切换样式）
 * - 控件下方描述所选模式的授权范围（读取/写入）
 * - PAT 直接登录：仅一个输入框（Enter 提交）——GitHub 主站（github.com）
 *   受限无法走 OAuth 授权页时，粘贴 Personal Access Token 经 Worker
 *   /$auth/pat 验证登录（凭据存 KV + httpOnly cookie，前端不落 localStorage）。
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, type ScopeMode } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { KeyRound, ShieldCheck, Eye, PencilLine } from "lucide-react";
import { SegmentedControl, type SegmentedOption } from "@/components/SegmentedControl";
import { InlineError } from "@/components/InlineError";
import { LOGIN_TRIGGER_ID } from "@/lib/ui/ripple-spotlight";

/** 登录按钮 + 权限选择对话框 */
export function LoginScopeDialog({
  children,
  defaultOpen,
}: {
  /** 自定义触发器（默认渲染「登录」按钮） */
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { login, loginWithPat } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [mode, setMode] = useState<ScopeMode>("read");
  // PAT 登录状态
  const [pat, setPat] = useState("");
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  // 权限模式分段控件选项（依赖 t，组件内定义）
  const modeOptions: SegmentedOption<ScopeMode>[] = [
    { value: "read", label: t("settings.mode.read"), icon: Eye },
    { value: "write", label: t("settings.mode.write"), icon: PencilLine },
  ];

  const doLogin = () => {
    login({ mode });
  };

  /** PAT 直接登录（Enter / 提交）：成功关闭对话框；无效/失败展示错误 */
  const doPatLogin = async () => {
    const token = pat.trim();
    if (!token || patBusy) return;
    setPatBusy(true);
    setPatError(null);
    try {
      const ok = await loginWithPat(token);
      if (ok) {
        setOpen(false);
        setPat("");
      } else {
        setPatError(t("login.pat.invalid"));
      }
    } catch {
      setPatError(t("login.pat.failed"));
    } finally {
      setPatBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? (
        <DialogTrigger asChild>{children}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          {/* id=涟漪聚光灯目标定位（topbar 登录按钮，RippleSpotlight 动画落点） */}
          <Button id={LOGIN_TRIGGER_ID}>{t("login.button")}</Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("login.title")}</DialogTitle>
          <DialogDescription>{t("login.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* OAuth2 授权登录（与下方 PAT 标题形成对照） */}
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
            {t("login.oauth.title")}
          </p>

          {/* 权限模式：分段控件（只读/完全控制） */}
          <SegmentedControl options={modeOptions} value={mode} onValueChange={setMode} />

          {/* 所选模式的授权范围（随选中模式切换） */}
          <p className="text-xs leading-snug text-muted-foreground">
            {mode === "read" ? t("login.mode.read.desc") : t("login.mode.write.desc")}
          </p>

          {/* PAT 直接登录：仅输入框（Enter 提交） */}
          <div className="border-t" />
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              {t("login.pat.title")}
            </p>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("login.pat.placeholder")}
              value={pat}
              onChange={(e) => {
                setPat(e.target.value);
                if (patError) setPatError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doPatLogin();
              }}
              disabled={patBusy}
              className="w-full"
            />
            <p className="text-xs leading-snug text-muted-foreground">{t("login.pat.desc")}</p>
            <p className="text-xs text-muted-foreground">{t("login.pat.enter")}</p>
            {patError && <InlineError message={patError} size="sm" />}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={doLogin}>{t("login.button")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
