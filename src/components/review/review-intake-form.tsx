"use client";

import { useId, useMemo, useRef, useState } from "react";

const MAX_WORDS = 5_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const supportedExtensions = [".pdf", ".docx", ".txt"];

const contentTypes = [
  { value: "blog_post", label: "Blog post" },
  { value: "seo_article", label: "SEO article" },
  { value: "thought_leadership", label: "Thought leadership" },
  { value: "other", label: "Other" },
] as const;

const acceptanceChecks = [
  {
    name: "Brief fit",
    detail: "Confirmed requirements and missing deliverables",
  },
  {
    name: "Evidence & citations",
    detail: "Claims, source needs, and link signals",
  },
  {
    name: "Editorial quality",
    detail: "Structure, clarity, grammar, and repetition",
  },
  {
    name: "AI-writing risk",
    detail: "A review signal, never proof of authorship",
  },
] as const;

function countWords(text: string) {
  return (
    text
      .replace(/https?:\/\/\S+/giu, " ")
      .match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  );
}

function extensionOf(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

type ReviewIntakeFormProps = {
  onCreated?: (nextPath: string) => void;
};

export function ReviewIntakeForm({ onCreated }: ReviewIntakeFormProps) {
  const instanceId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteTabRef = useRef<HTMLButtonElement>(null);
  const uploadTabRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<"paste" | "upload">("paste");
  const [bodyText, setBodyText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [contentType, setContentType] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefText, setBriefText] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wordCount = useMemo(() => countWords(bodyText), [bodyText]);
  const briefWordCount = useMemo(() => countWords(briefText), [briefText]);
  const articleTooLong = activeTab === "paste" && wordCount > MAX_WORDS;
  const briefTooLong = briefWordCount > MAX_WORDS;
  const hasArticle =
    activeTab === "paste" ? Boolean(bodyText.trim()) : Boolean(file);
  const blockingMessage = articleTooLong
    ? "This review exceeds your 5,000-word per-document limit."
    : briefTooLong
      ? "The content brief exceeds the 5,000-word limit."
      : clientError;
  const canSubmit =
    hasArticle &&
    Boolean(contentType) &&
    !articleTooLong &&
    !briefTooLong &&
    !clientError &&
    !isSubmitting;

  function chooseTab(nextTab: "paste" | "upload") {
    if (nextTab === activeTab) return true;
    const wouldReplace = activeTab === "paste" ? bodyText.trim() : file;
    if (
      wouldReplace &&
      !window.confirm("Replace the article source you already added?")
    ) {
      return false;
    }
    setBodyText("");
    setFile(null);
    setClientError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setActiveTab(nextTab);
    return true;
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const nextTab =
      event.key === "Home"
        ? "paste"
        : event.key === "End"
          ? "upload"
          : activeTab === "paste"
            ? "upload"
            : "paste";
    if (chooseTab(nextTab)) {
      (nextTab === "paste" ? pasteTabRef : uploadTabRef).current?.focus();
    }
  }

  function clearSelectedFile() {
    setFile(null);
    setClientError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function selectFile(selected: File | undefined) {
    setClientError(null);
    setFile(null);
    if (!selected) return;
    if (!supportedExtensions.includes(extensionOf(selected.name))) {
      setClientError("We can review PDF, DOCX, or TXT files.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setClientError("This file exceeds the 10 MB limit.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
  }

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      setClientError(
        !hasArticle
          ? "Paste text or upload a document."
          : "Choose a content type before starting the review.",
      );
      return;
    }

    setIsSubmitting(true);
    setClientError(null);
    const formData = new FormData();
    formData.set("contentType", contentType);
    formData.set("bodyText", activeTab === "paste" ? bodyText : "");
    formData.set("briefText", briefText);
    if (activeTab === "upload" && file) formData.set("file", file);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        error?: string;
        nextPath?: string;
      };
      if (!response.ok || !payload.nextPath) {
        setClientError(
          payload.error ?? "We couldn't create this review. Try again.",
        );
        return;
      }
      if (onCreated) onCreated(payload.nextPath);
      else window.location.assign(payload.nextPath);
    } catch {
      setClientError("We couldn't create this review. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="review-workspace">
      <main className="review-desk">
        <header className="review-intro">
          <p className="review-kicker">New acceptance review</p>
          <h1>Review content before it leaves your desk</h1>
          <p className="review-deck">
            Check an outsourced article against the standards that matter before
            you approve, pay, or publish.
          </p>
        </header>

        <form className="intake-form" onSubmit={submitReview} noValidate>
          {blockingMessage ? (
            <section className="validation-summary" role="alert" aria-live="assertive">
              <strong>Check the article details</strong>
              <p>{blockingMessage}</p>
            </section>
          ) : null}

          <section className="intake-section" aria-labelledby={`${instanceId}-article`}>
            <div className="section-heading-row">
              <div>
                <p className="section-label">Article source</p>
                <h2 id={`${instanceId}-article`}>Add the copy to review</h2>
              </div>
              <span className="required-mark">Required</span>
            </div>

            <div className="source-tabs" role="tablist" aria-label="Article input method">
              <button
                ref={pasteTabRef}
                type="button"
                role="tab"
                id={`${instanceId}-paste-tab`}
                aria-controls={`${instanceId}-paste-panel`}
                aria-selected={activeTab === "paste"}
                tabIndex={activeTab === "paste" ? 0 : -1}
                onClick={() => chooseTab("paste")}
                onKeyDown={handleTabKeyDown}
              >
                Paste text
              </button>
              <button
                ref={uploadTabRef}
                type="button"
                role="tab"
                id={`${instanceId}-upload-tab`}
                aria-controls={`${instanceId}-upload-panel`}
                aria-selected={activeTab === "upload"}
                tabIndex={activeTab === "upload" ? 0 : -1}
                onClick={() => chooseTab("upload")}
                onKeyDown={handleTabKeyDown}
              >
                Upload file
              </button>
            </div>

            <div
              role="tabpanel"
              id={`${instanceId}-paste-panel`}
              aria-labelledby={`${instanceId}-paste-tab`}
              hidden={activeTab !== "paste"}
            >
              <label className="field-label" htmlFor={`${instanceId}-body`}>
                Article text
              </label>
              <textarea
                id={`${instanceId}-body`}
                className="article-textarea"
                value={bodyText}
                onChange={(event) => {
                  setBodyText(event.target.value);
                  setClientError(null);
                }}
                placeholder="Paste the headline and full article here…"
                rows={14}
              />
              <div className="field-meta">
                <span className={articleTooLong ? "word-count over-limit" : "word-count"}>
                  {wordCount.toLocaleString()} words
                </span>
                <span>5,000-word limit</span>
              </div>
              {wordCount > 0 && wordCount < 300 ? (
                <p className="inline-notice" role="status">
                  <span aria-hidden="true">!</span>
                  AI-writing risk won&apos;t be assessed for text under 300 words.
                  The other checks will continue.
                </p>
              ) : null}
            </div>

            <div
              role="tabpanel"
              id={`${instanceId}-upload-panel`}
              aria-labelledby={`${instanceId}-upload-tab`}
              hidden={activeTab !== "upload"}
            >
              <div className="upload-well">
                <span className="upload-mark" aria-hidden="true">DOC</span>
                <div>
                  <label className="file-button" htmlFor={`${instanceId}-file`}>
                    Choose article file
                  </label>
                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    id={`${instanceId}-file`}
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={(event) => selectFile(event.target.files?.[0])}
                  />
                  <p>PDF, DOCX, or UTF-8 TXT · 10 MB max</p>
                  <p>
                    Word count is checked after upload. Documents under 300
                    words continue without AI-writing risk; documents over
                    5,000 words are rejected.
                  </p>
                </div>
              </div>
              {file ? (
                <div className="selected-file">
                  <span><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB</span>
                  <button type="button" onClick={clearSelectedFile}>
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <fieldset className="intake-section content-type-fieldset">
            <legend>Content type</legend>
            <p className="fieldset-help">Choose the closest editorial context.</p>
            <div className="content-type-grid">
              {contentTypes.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="contentType"
                    value={option.value}
                    checked={contentType === option.value}
                    onChange={(event) => {
                      setContentType(event.target.value);
                      setClientError(null);
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <section className="brief-section">
            <button
              className="brief-toggle"
              type="button"
              aria-expanded={briefOpen}
              aria-controls={`${instanceId}-brief-panel`}
              onClick={() => setBriefOpen((open) => !open)}
            >
              <span>Add a content brief (optional)</span>
              <span aria-hidden="true">{briefOpen ? "−" : "+"}</span>
            </button>
            {!briefOpen ? (
              <p>Without a brief, Brief fit will not be assessed.</p>
            ) : (
              <div id={`${instanceId}-brief-panel`} className="brief-panel">
                <label className="field-label" htmlFor={`${instanceId}-brief`}>
                  Content brief
                </label>
                <textarea
                  id={`${instanceId}-brief`}
                  value={briefText}
                  onChange={(event) => {
                    setBriefText(event.target.value);
                    setClientError(null);
                  }}
                  placeholder="Paste requirements, audience, required points, keywords, or citation expectations…"
                  rows={6}
                />
                <div className="field-meta">
                  <span>{briefWordCount.toLocaleString()} words</span>
                  <span>Optional · 5,000-word limit</span>
                </div>
              </div>
            )}
          </section>

          <footer className="submission-block">
            <p className="privacy-note">
              Your content is not used to train general-purpose models. Anonymous
              uploads are deleted within 24 hours. Results are advisory and do not
              prove authorship.
            </p>
            <button className="review-submit" type="submit" disabled={!canSubmit}>
              <span>{isSubmitting ? "Creating review…" : "Review content"}</span>
              <span aria-hidden="true">→</span>
            </button>
          </footer>
        </form>
      </main>

      <aside className="acceptance-rail" aria-labelledby={`${instanceId}-rail-title`}>
        <div className="rail-register" aria-hidden="true">
          <span />
          <span />
        </div>
        <div className="rail-heading">
          <p>Proof slip · 04 checks</p>
          <h2 id={`${instanceId}-rail-title`}>Acceptance pass</h2>
          <span>Prepared for editorial review</span>
        </div>
        <ul>
          {acceptanceChecks.map((check, index) => (
            <li key={check.name}>
              <span className="check-box" aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{check.name}</strong>
                <p>{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="rail-caveat">
          <span>Editorial control</span>
          <p>The final approval decision stays with your reviewer.</p>
        </div>
      </aside>
    </div>
  );
}
