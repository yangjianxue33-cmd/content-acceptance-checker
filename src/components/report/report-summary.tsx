import type { PublicReviewReport } from "@/server/reviews/get-report";

const CONTENT_TYPE_LABELS: Record<PublicReviewReport["contentType"], string> = {
  blog_post: "Blog post",
  seo_article: "SEO article",
  thought_leadership: "Thought leadership",
  other: "Other",
};

const RECOMMENDATION_LABELS: Record<
  NonNullable<PublicReviewReport["recommendation"]>,
  string
> = {
  ready_to_approve: "Ready to approve",
  request_revisions: "Request revisions",
  manual_review_required: "Manual review required",
};

const EVALUATION_LABELS = {
  met: "Met",
  partial: "Partial",
  missing: "Missing",
  not_assessed: "Not assessed",
} as const;

export const REPORT_DISCLAIMER =
  "Results are advisory, do not prove authorship or misconduct, and final approval stays with the editor.";

export function ReportSummary({ report }: { report: PublicReviewReport }) {
  return (
    <>
      <header className="report-hero">
        <div>
          <p className="section-label">Acceptance report</p>
          <h1>{report.title}</h1>
          <dl className="report-metadata" aria-label="Review details">
            <div>
              <dt>Content type</dt>
              <dd>{CONTENT_TYPE_LABELS[report.contentType]}</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{report.wordCount.toLocaleString("en-US")} words</dd>
            </div>
            <div>
              <dt>Report state</dt>
              <dd>{report.status === "partial" ? "Partial" : report.status === "failed" ? "Failed" : "Complete"}</dd>
            </div>
          </dl>
        </div>

        <div className="report-verdicts">
          <section className="score-slip" aria-label="Normalized score">
            <p>Normalized score</p>
            <strong>
              {report.score === null ? "Not available" : `${report.score} / 100`}
            </strong>
            <span>Available checks are reweighted.</span>
          </section>
          <section className="recommendation-slip" aria-label="System recommendation">
            <p>System recommendation</p>
            <strong>
              {report.recommendation
                ? RECOMMENDATION_LABELS[report.recommendation]
                : "Not available"}
            </strong>
            <span>This is not the editor&apos;s final decision.</span>
          </section>
        </div>
      </header>

      {report.status === "failed" ? (
        <p className="report-retry-guidance">
          The report has too few completed checks to calculate a score or recommendation. Return to progress and retry the analysis when ready.
        </p>
      ) : null}

      <section className="requirements-proof" aria-labelledby="requirements-title">
        <div className="report-section-heading">
          <div>
            <p className="section-label">Confirmed brief</p>
            <h2 id="requirements-title">Requirement evaluations</h2>
          </div>
          <span>{report.requirements.length} confirmed</span>
        </div>
        {report.requirements.length > 0 ? (
          <ul>
            {report.requirements.map((requirement, index) => (
              <li key={`${requirement.category}-${index}`}>
                <div>
                  <span>{requirement.category}</span>
                  {requirement.critical ? <strong>Critical requirement</strong> : null}
                </div>
                <p>{requirement.text}</p>
                <span data-evaluation={requirement.evaluation ?? "not_assessed"}>
                  {EVALUATION_LABELS[requirement.evaluation ?? "not_assessed"]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="report-empty-state">No confirmed brief requirements were supplied.</p>
        )}
      </section>

      <p className="report-disclaimer">
        <strong>Editorial advisory</strong>
        {REPORT_DISCLAIMER}
      </p>
    </>
  );
}
