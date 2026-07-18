import type { Metadata } from "next";
import Link from "next/link";

import { ReviewIntakeForm } from "@/components/review/review-intake-form";

export const metadata: Metadata = {
  title: "New acceptance review",
  description:
    "Review outsourced content for brief fit, evidence, editorial quality, and AI-writing risk.",
};

export default function ReviewPage() {
  return (
    <div className="product-shell">
      <header className="product-header">
        <Link className="product-brand" href="/" aria-label="Content Acceptance Checker home">
          <span aria-hidden="true">CAC</span>
          <strong>Content Acceptance Checker</strong>
        </Link>
        <p>Agency editorial desk</p>
      </header>
      <ReviewIntakeForm />
    </div>
  );
}
