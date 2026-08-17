/**
 * 仓库 Webhooks 设置页（官方 github.com/:owner/:repo/settings/hooks）
 *
 * 官方结构：H1「Webhooks」→ Add webhook 按钮 → 列表（URL + 事件数 + 最近投递状态
 * + 编辑/删除）→ 每项可展开 Recent deliveries（投递历史 + Redeliver）。
 * 整体 REST-only（GraphQL 无 webhook 端点，见 api-webhooks.ts 理由）。
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Webhook, Plus, Pencil, Trash2, History, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type I18nKey } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/InlineError";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toastSuccess } from "@/lib/ui/toast";
import { useDateFormat } from "@/hooks/useDateFormat";
import { WEBHOOK_EVENTS, apiErrorMessage } from "@/lib/restapi";
import {
  fetchRepoWebhooksSmart,
  createRepoWebhookSmart,
  updateRepoWebhookSmart,
  deleteRepoWebhookSmart,
  fetchWebhookDeliveriesSmart,
  redeliverWebhookDeliverySmart,
} from "@/lib/api";
import type { RepoWebhook, RepoWebhookDelivery, WebhookInput } from "@/lib/restapi";

export default function RepoWebhooksSettings() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const { fmt } = useDateFormat();
  const [webhooks, setWebhooks] = useState<RepoWebhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 新建/编辑弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RepoWebhook | null>(null);
  const [url, setUrl] = useState("");
  const [contentType, setContentType] = useState<"json" | "form">("json");
  const [secret, setSecret] = useState("");
  const [insecureSsl, setInsecureSsl] = useState(false);
  const [events, setEvents] = useState<Set<string>>(new Set(["push"]));
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 删除确认
  const [deleting, setDeleting] = useState<RepoWebhook | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Recent deliveries 展开
  const [expanded, setExpanded] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<RepoWebhookDelivery[] | null>(null);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setWebhooks(null);
    setError(null);
    fetchRepoWebhooksSmart(owner, repo, token)
      .then(setWebhooks)
      .catch((e) => setError(apiErrorMessage(e, t("repoWebhooks.loadFailed"))));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, token]);

  const openCreate = () => {
    setEditing(null);
    setUrl("");
    setContentType("json");
    setSecret("");
    setInsecureSsl(false);
    setEvents(new Set(["push"]));
    setActive(true);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (w: RepoWebhook) => {
    setEditing(w);
    setUrl(w.config.url);
    setContentType(w.config.content_type === "form" ? "form" : "json");
    setSecret(w.config.secret ?? "");
    setInsecureSsl(w.config.insecure_ssl === "1");
    setEvents(new Set(w.events));
    setActive(w.active);
    setFormError(null);
    setFormOpen(true);
  };

  const toggleEvent = (value: string) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const submit = async () => {
    if (!token || !url.trim() || busy) return;
    const input: WebhookInput = {
      url: url.trim(),
      contentType,
      ...(secret ? { secret } : {}),
      insecureSsl,
      events: [...events],
      active,
    };
    setBusy(true);
    setFormError(null);
    try {
      if (editing) {
        await updateRepoWebhookSmart(owner, repo, editing.id, input, token);
        toastSuccess(t("repoWebhooks.updated"));
      } else {
        await createRepoWebhookSmart(owner, repo, input, token);
        toastSuccess(t("repoWebhooks.created"));
      }
      setFormOpen(false);
      load();
    } catch (e) {
      setFormError(apiErrorMessage(e, t("repoWebhooks.saveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteRepoWebhookSmart(owner, repo, deleting.id, token);
      setWebhooks((prev) => (prev ?? []).filter((w) => w.id !== deleting.id));
      toastSuccess(t("repoWebhooks.deleted"));
      setDeleting(null);
    } catch (e) {
      setError(apiErrorMessage(e, t("repoWebhooks.deleteFailed")));
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleDeliveries = (id: number) => {
    if (expanded === id) {
      setExpanded(null);
      setDeliveries(null);
      setDeliveriesError(null);
      return;
    }
    setExpanded(id);
    setDeliveries(null);
    setDeliveriesError(null);
    setDeliveriesLoading(true);
    fetchWebhookDeliveriesSmart(owner, repo, id, token)
      .then((d) => setDeliveries(d))
      .catch((e) => setDeliveriesError(apiErrorMessage(e, t("repoWebhooks.loadFailed"))))
      .finally(() => setDeliveriesLoading(false));
  };

  const redeliver = async (deliveryId: number) => {
    if (!token || expanded === null) return;
    await redeliverWebhookDeliverySmart(owner, repo, expanded, deliveryId, token);
    toastSuccess(t("repoWebhooks.redelivered"));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("repoWebhooks.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("repoWebhooks.desc")}</p>
        </div>
        <Button onClick={openCreate} disabled={!token} className="shrink-0">
          <Plus className="size-4" />
          {t("repoWebhooks.add")}
        </Button>
      </div>

      {error && <InlineError message={error} />}

      {webhooks === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("repoWebhooks.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {webhooks.map((w) => (
            <li key={w.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Webhook className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-sm">{w.config.url}</span>
                    <Badge variant={w.active ? "default" : "secondary"}>
                      {w.active ? t("repoWebhooks.active") : t("repoWebhooks.inactive")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("repoWebhooks.eventCount", { count: w.events.length })}
                    {w.last_response?.status
                      ? ` · ${t("repoWebhooks.lastDelivery")} ${w.last_response.status}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleDeliveries(w.id)}
                    title={t("repoWebhooks.deliveries")}
                    aria-label={t("repoWebhooks.deliveries")}
                  >
                    <History className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(w)}
                    title={t("repoWebhooks.edit")}
                    aria-label={t("repoWebhooks.edit")}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleting(w)}
                    disabled={deleteBusy}
                    title={t("repoWebhooks.remove")}
                    aria-label={t("repoWebhooks.remove")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Recent deliveries 展开区 */}
              {expanded === w.id && (
                <div className="mt-3 border-t pt-3">
                  {deliveriesLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                      ))}
                    </div>
                  ) : deliveriesError ? (
                    <InlineError message={deliveriesError} size="sm" />
                  ) : deliveries === null || deliveries.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">
                      {t("repoWebhooks.noDeliveries")}
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {deliveries.map((d) => (
                        <li key={d.id} className="flex items-center gap-3 py-2">
                          <Badge
                            variant={
                              d.status_code >= 200 && d.status_code < 400
                                ? "default"
                                : "destructive"
                            }
                          >
                            {d.status_code}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{d.event}</p>
                            <p className="text-xs text-muted-foreground">{fmt(d.delivered_at)}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            onClick={() => void redeliver(d.id)}
                            title={t("repoWebhooks.redeliver")}
                            aria-label={t("repoWebhooks.redeliver")}
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 新建/编辑弹窗 */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("repoWebhooks.editTitle") : t("repoWebhooks.addTitle")}
            </DialogTitle>
            <DialogDescription>{t("repoWebhooks.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="wh-url" className="mb-1.5 block">
                {t("repoWebhooks.urlLabel")}
              </Label>
              <Input
                id="wh-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="wh-ct" className="mb-1.5 block">
                  {t("repoWebhooks.contentTypeLabel")}
                </Label>
                <Select
                  value={contentType}
                  onValueChange={(v) => setContentType(v as "json" | "form")}
                >
                  <SelectTrigger id="wh-ct" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">application/json</SelectItem>
                    <SelectItem value="form">application/x-www-form-urlencoded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="wh-secret" className="mb-1.5 block">
                  {t("repoWebhooks.secretLabel")}
                </Label>
                <Input
                  id="wh-secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={t("repoWebhooks.secretPlaceholder")}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("repoWebhooks.insecureSsl")}</p>
                <p className="text-sm text-muted-foreground">{t("repoWebhooks.insecureSslDesc")}</p>
              </div>
              <Switch checked={insecureSsl} onCheckedChange={setInsecureSsl} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{t("repoWebhooks.activeLabel")}</p>
                <p className="text-sm text-muted-foreground">{t("repoWebhooks.activeDesc")}</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>

            {/* 事件多选 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm font-medium">{t("repoWebhooks.eventsLabel")}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEvents(new Set(["push"]))}
                  >
                    {t("repoWebhooks.onlyPush")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEvents(new Set(WEBHOOK_EVENTS.map((e) => e.value)))}
                  >
                    {t("repoWebhooks.allEvents")}
                  </Button>
                </div>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {WEBHOOK_EVENTS.map((e) => (
                  <label
                    key={e.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={events.has(e.value)}
                      onCheckedChange={() => toggleEvent(e.value)}
                    />
                    {t(e.labelKey as I18nKey)}
                  </label>
                ))}
              </div>
            </div>

            {formError && <InlineError message={formError} size="sm" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={busy || !url.trim() || events.size === 0}
            >
              {busy
                ? t("common.submitting")
                : editing
                  ? t("repoWebhooks.update")
                  : t("repoWebhooks.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("repoWebhooks.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("repoWebhooks.removeDesc", { url: deleting?.config.url ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteBusy ? t("common.loading") : t("repoWebhooks.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
