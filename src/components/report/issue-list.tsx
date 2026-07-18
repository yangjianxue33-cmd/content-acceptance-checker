import type { PublicReviewReport } from "@/server/reviews/get-report";

type ReportIssue = PublicReviewReport["issues"][number];
type Severity = ReportIssue["severity"];

const SEVERITIES: readonly Severity[] = ["critical", "major", "minor"];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

const MODULE_LABELS: Record<ReportIssue["module"], string> = {
  brief_fit: "Brief fit",
  evidence_citations: "Evidence & citations",
  editorial_quality: "Editorial quality",
  ai_risk: "AI-writing risk",
};

export function IssueList({ issues }: { issues: PublicReviewReport["issues"] }) {
  if (issues.length === 0) {
    return (
      <section className="report-findings" aria-labelledby="findings-title">
        <div className="report-section-heading">
          <div>
            <p className="section-label">Action desk</p>
            <h2 id="findings-title">Editorial findings</h2>
          </div>
        </div>
        <p className="report-empty-state">No actionable issues were found in the completed checks.</p>
      </section>
    );
  }

  return (
    <section className="report-findings" aria-labelledby="findings-title">
      <div className="report-section-heading">
        <div>
          <p className="section-label">Action desk</p>
          <h2 id="findings-title">Editorial findings</h2>
        </div>
        <span>{issues.length} total</span>
      </div>

      <div className="severity-stack">
        {SEVERITIES.map((severity) => {
          const groupedIssues = issues.filter((issue) => issue.severity === severity);
          if (groupedIssues.length === 0) return null;
          const headingId = `${severity}-issues-title`;
          return (
            <section
              className="severity-group"
              data-severity={severity}
              aria-label={`${SEVERITY_LABELS[severity]} issues`}
              key={severity}
            >
              <header>
                <h3 id={headingId}>{SEVERITY_LABELS[severity]}</h3>
                <span>{groupedIssues.length}</span>
              </header>
              <ol>
                {groupedIssues.map((issue, index) => (
                  <li key={`${issue.module}-${severity}-${index}`}>
                    <div className="issue-register">
                      <span>{MODULE_LABELS[issue.module]}</span>
                      <strong>{SEVERITY_LABELS[severity]} issue</strong>
                    </div>
                    {issue.sourceExcerpt ? (
                      <blockquote>
                        <span>Read-only source context</span>
                        <p>{issue.sourceExcerpt}</p>
                      </blockquote>
                    ) : null}
                    <div className="issue-resolution">
                      <div>
                        <span>Why it matters</span>
                        <p>{issue.explanation}</p>
                      </div>
                      <div>
                        <span>Suggested action</span>
                        <p>{issue.suggestedAction}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}
