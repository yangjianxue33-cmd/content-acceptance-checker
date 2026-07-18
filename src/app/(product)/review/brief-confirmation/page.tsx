import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { RequirementsEditor } from "@/components/review/requirements-editor";
import {
  loadProductionRequirements,
  RequirementsAccessError,
  RequirementsLoadError,
} from "@/server/reviews/confirm-requirements";

export const metadata: Metadata = {
  title: "Confirm brief requirements",
  description: "Confirm the acceptance requirements extracted from your brief.",
};

type PageProps = {
  searchParams: Promise<{ reviewId?: string | string[] }>;
};

export default async function BriefConfirmationPage({
  searchParams,
}: PageProps) {
  const suppliedReviewId = (await searchParams).reviewId;
  if (typeof suppliedReviewId !== "string") notFound();

  const cookieStore = await cookies();
  const accessToken = cookieStore.get("anonymous_review_access")?.value ?? null;
  let result;
  try {
    result = await loadProductionRequirements({
      reviewId: suppliedReviewId,
      accessToken,
    });
  } catch (error) {
    if (error instanceof RequirementsAccessError) notFound();
    if (!(error instanceof RequirementsLoadError)) throw error;
    return (
      <ProductFrame>
        <main className="confirmation-workspace">
          <section className="confirmation-load-error" role="alert">
            <p className="section-label">Brief unavailable</p>
            <h1>Requirements could not be loaded.</h1>
            <p>
              The private brief could not be read or processed. Return to the
              review desk and try again.
            </p>
            <Link href="/review">Start a new review</Link>
          </section>
        </main>
      </ProductFrame>
    );
  }

  if (result.kind === "redirect") {
    return (
      <ProductFrame>
        <main className="confirmation-workspace">
          <RequirementsEditor
            reviewId={suppliedReviewId}
            initialRequirements={[]}
            skipTo={result.nextPath}
          />
        </main>
      </ProductFrame>
    );
  }

  return (
    <ProductFrame>
      <main className="confirmation-workspace">
        <header className="confirmation-intro">
          <div>
            <p className="review-kicker">Brief confirmation</p>
            <h1>Set the acceptance line.</h1>
          </div>
          <p>
            We extracted the brief into a working checklist. Edit what the
            article must achieve, mark non-negotiables, and remove anything that
            should not affect acceptance.
          </p>
        </header>

        <div className="confirmation-layout">
          <RequirementsEditor
            reviewId={result.reviewId}
            initialRequirements={result.requirements}
          />

          <aside className="confirmation-rail" aria-labelledby="next-step-title">
            <p className="section-label">Decision boundary</p>
            <h2 id="next-step-title">What happens next</h2>
            <ol>
              <li>
                <strong>Confirm this register</strong>
                <span>Your edits become the brief-fit checklist.</span>
              </li>
              <li>
                <strong>Continue to the review</strong>
                <span>The review is queued; analysis runs in the next stage.</span>
              </li>
            </ol>
            <p className="rail-privacy">
              Article and brief files remain private. Only the requirement text
              and cited excerpts shown here reach this editor.
            </p>
          </aside>
        </div>
      </main>
    </ProductFrame>
  );
}

function ProductFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="product-shell">
      <header className="product-header">
        <Link
          className="product-brand"
          href="/"
          aria-label="Content Acceptance Checker home"
        >
          <span aria-hidden="true">CAC</span>
          <strong>Content Acceptance Checker</strong>
        </Link>
        <p>Agency editorial desk</p>
      </header>
      {children}
    </div>
  );
}
