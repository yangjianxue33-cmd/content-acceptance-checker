import type { Metadata } from "next";
import Link from "next/link";

import { ReviewProgress } from "@/components/review/review-progress";

export const metadata: Metadata = {
  title: "Review in progress",
  description: "Follow each independent editorial acceptance check.",
};

export default async function ReviewProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      <main className="progress-workspace">
        <ReviewProgress reviewId={id} />
      </main>
    </div>
  );
}
