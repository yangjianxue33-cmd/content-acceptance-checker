import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DecisionControl } from "@/components/report/decision-control";
import { IssueList } from "@/components/report/issue-list";
import { ModuleCard } from "@/components/report/module-card";
import { ReportSummary } from "@/components/report/report-summary";
import {
  getProductionReviewReport,
  ReviewReportAccessError,
} from "@/server/reviews/get-report";

export const metadata: Metadata = {
  title: "Acceptance report",
  description: "Review editorial findings and record the editor decision.",
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: reviewId } = await params;
  const accessToken = (await cookies()).get("anonymous_review_access")?.value ?? null;
  let result;
  try {
    result = await getProductionReviewReport({ reviewId, accessToken });
  } catch (error) {
    if (error instanceof ReviewReportAccessError) notFound();
    throw error;
  }

  if (result.kind === "progress") redirect(result.progressPath);
  const { report } = result;

  return (
    <div className="product-shell">
      <header className="product-header">
        <Link className="product-brand" href="/" aria-label="Content Acceptance Checker home">
          <span aria-hidden="true">CAC</span>
          <strong>Content Acceptance Checker</strong>
        </Link>
        <p>Agency editorial desk</p>
      </header>

      <main className="report-workspace">
        <ReportSummary report={report} />

        <section className="module-report" aria-labelledby="module-report-title">
          <div className="report-section-heading">
            <div>
              <p className="section-label">Four independent checks</p>
              <h2 id="module-report-title">Module results</h2>
            </div>
            <span>Status and caveats shown explicitly</span>
          </div>
          <div className="module-report-grid">
            {report.modules.map((module, index) => (
              <ModuleCard key={module.module} module={module} index={index} />
            ))}
          </div>
        </section>

        <IssueList issues={report.issues} />

        {report.status === "failed" || report.status === "partial" ? (
          <aside className="report-retry-card" aria-label="Retry guidance">
            <div>
              <strong>{report.status === "failed" ? "Analysis did not produce a scored report." : "One or more checks were unavailable."}</strong>
              <p>Retrying returns to live progress and preserves this review&apos;s anonymous access boundary.</p>
            </div>
            <Link href={`/review/progress/${reviewId}`}>Return to progress and retry</Link>
          </aside>
        ) : null}

        <DecisionControl reviewId={reviewId} initialDecision={report.decision} />
      </main>
    </div>
  );
}
