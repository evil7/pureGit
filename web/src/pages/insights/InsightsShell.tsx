/**
 * Insights 子页共享外壳（左栏 InsightsNav + 标题区 + 内容）
 * 各子页复用，避免重复 PageLayout + InsightsNav 样板。
 */
import type { ReactNode } from "react";
import PageLayout from "@/components/PageLayout";
import InsightsNav from "./InsightsNav";

export default function InsightsShell({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <PageLayout gap="lg" left={{ node: <InsightsNav />, width: 240, sticky: "nav" }}>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
        </div>
        {children}
      </div>
    </PageLayout>
  );
}
