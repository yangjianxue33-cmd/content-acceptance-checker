"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Requirement = {
  id?: string;
  category: string;
  text: string;
  isCritical: boolean;
  sourceExcerpt: string | null;
};

type EditorRequirement = Requirement & { editorId: string };

type RequirementsEditorProps = {
  reviewId: string;
  initialRequirements: Requirement[];
  skipTo?: string;
  onNavigate?: (nextPath: string) => void;
};

const subscribeToHydration = () => () => {};

export function RequirementsEditor({
  reviewId,
  initialRequirements,
  skipTo,
  onNavigate,
}: RequirementsEditorProps) {
  const nextEditorId = useRef(initialRequirements.length);
  const [requirements, setRequirements] = useState<EditorRequirement[]>(() =>
    initialRequirements.map((requirement, index) => ({
      ...requirement,
      editorId: requirement.id ?? `initial-${index}`,
    })),
  );
  const [saving, setSaving] = useState(false);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [error, setError] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const categoryRefs = useRef(new Map<string, HTMLInputElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);

  function navigate(nextPath: string) {
    if (onNavigate) onNavigate(nextPath);
    else window.location.assign(nextPath);
  }

  useEffect(() => {
    if (skipTo) navigate(skipTo);
    // Navigation is intentionally a one-time response to the server load result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTo]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    if (pendingFocus.current === "add") addButtonRef.current?.focus();
    else categoryRefs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [requirements]);

  function updateRequirement(
    editorId: string,
    update: Partial<Requirement>,
  ) {
    setRequirements((current) =>
      current.map((requirement) =>
        requirement.editorId === editorId
          ? { ...requirement, ...update }
          : requirement,
      ),
    );
  }

  function addRequirement() {
    const editorId = `added-${nextEditorId.current}`;
    nextEditorId.current += 1;
    pendingFocus.current = editorId;
    setRequirements((current) => [
      ...current,
      {
        editorId,
        category: "",
        text: "",
        isCritical: false,
        sourceExcerpt: null,
      },
    ]);
  }

  function deleteRequirement(editorId: string) {
    pendingFocus.current = "add";
    setRequirements((current) =>
      current.filter((requirement) => requirement.editorId !== editorId),
    );
  }

  async function saveRequirements(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (savingRef.current) return;

    const invalid = requirements.find(
      (requirement) =>
        !requirement.category.trim() || !requirement.text.trim(),
    );
    if (invalid) {
      setError("Add a category and requirement text before continuing.");
      categoryRefs.current.get(invalid.editorId)?.focus();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${reviewId}/requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements: requirements.map(
            ({ category, text, isCritical, sourceExcerpt }) => ({
              category,
              text,
              isCritical,
              sourceExcerpt,
            }),
          ),
        }),
      });
      const payload: { error?: string; nextPath?: string } =
        await response.json();
      if (!response.ok || !payload.nextPath) {
        setError(payload.error ?? "Requirements could not be saved. Try again.");
        return;
      }
      navigate(payload.nextPath);
    } catch {
      setError("Requirements could not be saved. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (skipTo) {
    return <p role="status">Continuing to your review…</p>;
  }

  return (
    <form className="requirements-editor" onSubmit={saveRequirements}>
      <div className="requirements-toolbar">
        <div>
          <p className="section-label">Acceptance register</p>
          <h2>Requirements to check</h2>
        </div>
        <button
          ref={addButtonRef}
          className="add-requirement"
          type="button"
          onClick={addRequirement}
          disabled={saving || !hydrated}
        >
          <span aria-hidden="true">+</span> Add requirement
        </button>
      </div>

      <p className="reference-key">
        <strong>Reference from brief</strong> appears beneath extracted items and
        stays read-only.
      </p>

      {error ? (
        <div className="validation-summary" role="alert">
          <strong>Requirements not saved</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="requirement-list">
        {requirements.map((requirement, index) => {
          const number = index + 1;
          return (
            <fieldset
              className="requirement-card"
              key={requirement.editorId}
              disabled={saving || !hydrated}
            >
              <legend>
                <span>Requirement</span>
                <strong>{String(number).padStart(2, "0")}</strong>
              </legend>

              <div className="requirement-fields">
                <div>
                  <label
                    className="field-label"
                    htmlFor={`${requirement.editorId}-category`}
                  >
                    Category
                  </label>
                  <input
                    ref={(element) => {
                      if (element) {
                        categoryRefs.current.set(requirement.editorId, element);
                      } else {
                        categoryRefs.current.delete(requirement.editorId);
                      }
                    }}
                    id={`${requirement.editorId}-category`}
                    aria-label={`Requirement ${number} category`}
                    value={requirement.category}
                    maxLength={80}
                    onChange={(event) =>
                      updateRequirement(requirement.editorId, {
                        category: event.target.value,
                      })
                    }
                    disabled={saving}
                  />
                </div>

                <div>
                  <label
                    className="field-label"
                    htmlFor={`${requirement.editorId}-text`}
                  >
                    Requirement
                  </label>
                  <textarea
                    id={`${requirement.editorId}-text`}
                    aria-label={`Requirement ${number} text`}
                    value={requirement.text}
                    maxLength={1_000}
                    rows={3}
                    onChange={(event) =>
                      updateRequirement(requirement.editorId, {
                        text: event.target.value,
                      })
                    }
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="requirement-actions">
                <label className="critical-toggle">
                  <input
                    type="checkbox"
                    aria-label={`Requirement ${number} is critical`}
                    checked={requirement.isCritical}
                    onChange={(event) =>
                      updateRequirement(requirement.editorId, {
                        isCritical: event.target.checked,
                      })
                    }
                    disabled={saving}
                  />
                  <span>Critical for acceptance</span>
                </label>
                <button
                  type="button"
                  className="delete-requirement"
                  aria-label={`Delete requirement ${number}`}
                  onClick={() => deleteRequirement(requirement.editorId)}
                  disabled={saving}
                >
                  Delete
                </button>
              </div>

              {requirement.sourceExcerpt ? (
                <blockquote
                  className="source-reference"
                  aria-label={`Source excerpt for requirement ${number}`}
                >
                  <span aria-hidden="true">“</span>
                  <span>{requirement.sourceExcerpt}</span>
                  <span aria-hidden="true">”</span>
                </blockquote>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="requirements-submit-bar">
        <p>
          Your confirmed list becomes the brief-fit acceptance checklist.
        </p>
        <button
          className="review-submit"
          type="button"
          disabled={saving || !hydrated}
          onClick={() => void saveRequirements()}
        >
          <span>{saving ? "Saving requirements…" : "Continue to review"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  );
}
