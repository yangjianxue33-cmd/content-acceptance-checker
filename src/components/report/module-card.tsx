import type { PublicReviewReport } from "@/server/reviews/get-report";

type ReportModule = PublicReviewReport["modules"][number];

const STATUS_LABELS: Record<ReportModule["status"], string> = {
  queued: "Queued",
  reviewing: "Reviewing",
  complete: "Complete",
  not_assessed: "Not assessed",
  unavailable: "Unavailable",
};

const RISK_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High — manual review",
  not_assessed: "Not assessed",
} as const;

export function ModuleCard({
  module,
  index,
}: {
  module: ReportModule;
  index: number;
}) {
  return (
    <article className="report-module-card" data-status={module.status}>
      <header>
        <span className="module-index" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <h3>{module.label}</h3>
          <span className="report-module-status">{STATUS_LABELS[module.status]}</span>
        </div>
        <div className="module-score" aria-label={`${module.label} score`}>
          <span>Score</span>
          <strong>{module.score === null ? "—" : module.score}</strong>
        </div>
      </header>

      <div className="module-card-body">
        {module.module === "ai_risk" && module.aiRisk ? (
          <p className="risk-band">
            <span>Risk band</span>
            <strong>{RISK_LABELS[module.aiRisk]}</strong>
          </p>
        ) : null}
        {module.summary ? (
          <p>{module.summary}</p>
        ) : module.status === "unavailable" ? (
          <p>This check is unavailable. Use the completed checks as context and retry from the progress page.</p>
        ) : module.status === "not_assessed" ? (
          <p>This check was not assessed; no conclusion was produced.</p>
        ) : (
          <p>No public summary is available for this check.</p>
        )}
        {module.caveats.length > 0 ? (
          <div className="module-caveats">
            <strong>Caveats</strong>
            <ul>
              {module.caveats.map((caveat, caveatIndex) => (
                <li key={`${caveat}-${caveatIndex}`}>{caveat}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
