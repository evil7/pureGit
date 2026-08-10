/**
 * 账户设置 —— 个人资料（按官方补齐）
 *
 * 展示 + 编辑当前用户画像：
 * - 读取：GraphQL viewer 首选 + REST /user 降级（api.ts fetchViewerSmart）
 * - 保存：GraphQL updateUser 首选 + REST PATCH /user 降级（api.ts updateUserProfileSmart）
 * - 按官方补齐：Public email 显示 + Profile picture 区（API 无改头像端点，
 *   仅展示头像，修改跳官方统一走左栏底部按钮，去页内跳转按钮）
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/InlineError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import { PermissionGate } from "@/components/WriteGate";
import { fetchViewerSmart, updateUserProfileSmart, type ViewerProfile } from "@/lib/api";
import { EmailsSection } from "./EmailsSection";

export default function ProfileSettings() {
  const { token, canWrite } = useAuth();
  const { t } = useI18n();
  const [viewer, setViewer] = useState<ViewerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 编辑表单
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [bio, setBio] = useState("");
  const [pronouns, setPronouns] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchViewerSmart(token)
      .then((v) => {
        if (cancelled) return;
        setViewer(v);
        setName(v.name ?? "");
        setCompany(v.company ?? "");
        setLocation(v.location ?? "");
        setWebsiteUrl(v.websiteUrl ?? "");
        setBio(v.bio ?? "");
        setPronouns(v.pronouns ?? "");
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const save = async () => {
    if (!token || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateUserProfileSmart(token, {
        name,
        bio,
        company,
        location,
        websiteUrl,
        pronouns,
      });
      setViewer(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {error && <InlineError message={t("profileSettings.saveFailed").replace("{error}", error)} />}
      {saved && <p className="text-sm text-chart-1">{t("profileSettings.saved")}</p>}

      {/* 个人资料（排序：姓名·公司 / 网站·位置 / 个人简介） */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("profileSettings.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("profileSettings.desc")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name" className="mb-1.5 block">
              {t("profileSettings.name")}
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="company" className="mb-1.5 block">
              {t("profileSettings.company")}
            </Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="website" className="mb-1.5 block">
              {t("profileSettings.website")}
            </Label>
            <Input
              id="website"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label htmlFor="location" className="mb-1.5 block">
              {t("profileSettings.location")}
            </Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bio" className="mb-1.5 block">
              {t("profileSettings.bio")}
            </Label>
            <Input
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pronouns" className="mb-1.5 block">
              {t("profileSettings.pronouns")}
            </Label>
            <Input
              id="pronouns"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder={t("profileSettings.pronounsPlaceholder")}
              disabled={!canWrite}
            />
          </div>
        </div>

        {/* 保存（官方 Update profile 位于底部；只读模式置灰） */}
        <div className="flex items-center gap-3">
          <PermissionGate permission="editAccount">
            <Button onClick={() => void save()} disabled={saving || !viewer || !canWrite}>
              {saving ? t("common.saving") : t("profileSettings.saveButton")}
            </Button>
          </PermissionGate>
        </div>
      </section>

      {/* 邮箱（阶段 4 合并：原独立 Emails 页并入本页分区堆叠） */}
      <EmailsSection />
    </div>
  );
}
