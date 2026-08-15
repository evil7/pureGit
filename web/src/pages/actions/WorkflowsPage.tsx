/**
 * Workflows 列表页（/:owner/:repo/actions/workflows）
 *
 * 自 ActionsPages.tsx 拆出。workflow 列表 + Run workflow 手动触发（workflow_dispatch）。
 */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Play, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InlineError } from "@/components/InlineError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import {
  fetchWorkflows,
  dispatchWorkflow,
  apiErrorMessage,
  normalizeApiError,
  ApiError,
} from "@/lib/api";
import type { Workflow } from "@/lib/restapi";
import { WriteGate } from "@/components/WriteGate";

export default function WorkflowsPage() {
  const { owner = "", repo = "" } = useParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetchWorkflows(owner, repo, token, 200)
      .then((wfs) => {
        if (!cancelled) setWorkflows(wfs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(normalizeApiError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (error) throw error;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("actions.workflowsPage")}</h1>
      {workflows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty.actions")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {workflows.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-4 py-3">
              <Zap className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{w.name}</p>
                <p className="truncate text-xs text-muted-foreground">{w.path}</p>
              </div>
              <Badge variant={w.state === "active" ? "default" : "secondary"}>
                {w.state === "active" ? t("actions.active") : w.state}
              </Badge>
              <WorkflowDispatch w={w} owner={owner} repo={repo} token={token} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 手动触发 workflow（workflow_dispatch；需 write，默认 ref = 默认分支） */
function WorkflowDispatch({
  w,
  owner,
  repo,
  token,
}: {
  w: Workflow;
  owner: string;
  repo: string;
  token: string | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !ref.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await dispatchWorkflow(owner, repo, w.id, ref.trim(), token);
      setOpen(false);
      setRef("");
      navigate(`/${owner}/${repo}/actions`);
    } catch (err) {
      setError(apiErrorMessage(err, t("actions.dispatchFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <WriteGate>
        <Button
          variant="outline"
          onClick={() => {
            setRef("");
            setOpen(true);
          }}
        >
          <Play className="size-3.5" />
          {t("actions.runWorkflow")}
        </Button>
      </WriteGate>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("actions.runWorkflow")}: {w.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("actions.branch")}</label>
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="main"
                autoFocus
              />
            </div>
            {error && <InlineError message={error} size="sm" />}
            <DialogFooter>
              <Button type="submit" disabled={busy || !ref.trim()}>
                {busy ? t("common.saving") : t("actions.dispatch")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
