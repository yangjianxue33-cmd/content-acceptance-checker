import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { RequirementsEditor } from "./requirements-editor";

const reviewId = "11111111-1111-4111-8111-111111111111";
const initialRequirements = [
  {
    category: "Audience",
    text: "Write for agency editors.",
    isCritical: false,
    sourceExcerpt: "The audience is agency editorial teams.",
  },
  {
    category: "Evidence",
    text: "Include a customer example.",
    isCritical: true,
    sourceExcerpt: "Include one named customer example.",
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RequirementsEditor", () => {
  test("supports keyboard editing and critical toggling", async () => {
    const user = userEvent.setup();
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={initialRequirements}
      />,
    );

    const category = screen.getByLabelText("Requirement 1 category");
    category.focus();
    await user.keyboard("{Control>}a{/Control}Audience and voice");
    await user.tab();
    await user.keyboard("{Control>}a{/Control}Write for operations leaders.");
    await user.tab();
    await user.keyboard(" ");

    expect(category).toHaveValue("Audience and voice");
    expect(screen.getByLabelText("Requirement 1 text")).toHaveValue(
      "Write for operations leaders.",
    );
    expect(screen.getByLabelText("Requirement 1 is critical")).toBeChecked();
  }, 10_000);

  test("shows the source excerpt as read-only brief reference", () => {
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={initialRequirements}
      />,
    );

    expect(screen.getByText("Reference from brief")).toBeInTheDocument();
    expect(
      screen.getByText("The audience is agency editorial teams."),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("The audience is agency editorial teams."),
    ).not.toBeInTheDocument();
  });

  test("adds and deletes requirements while preserving a useful keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={initialRequirements}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add requirement" }));
    const addedCategory = screen.getByLabelText("Requirement 3 category");
    expect(addedCategory).toHaveFocus();

    await user.type(addedCategory, "Call to action");
    await user.click(
      screen.getByRole("button", { name: "Delete requirement 3" }),
    );

    expect(screen.queryByLabelText("Requirement 3 category")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add requirement" })).toHaveFocus();
  });

  test("disables Continue while saving and prevents a double submit", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(request);
    vi.stubGlobal("fetch", fetchMock);
    const onNavigate = vi.fn();
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={initialRequirements}
        onNavigate={onNavigate}
      />,
    );

    const continueButton = screen.getByRole("button", {
      name: "Continue to review",
    });
    await user.click(continueButton);
    await user.click(continueButton);

    expect(continueButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest(
        Response.json({ nextPath: `/review/progress/${reviewId}` }),
      );
      await request;
    });
    expect(onNavigate).toHaveBeenCalledWith(`/review/progress/${reviewId}`);
  });

  test("announces a safe save error and allows retry", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "Check each requirement and try again." },
          { status: 400 },
        ),
      ),
    );
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={initialRequirements}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Continue to review" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check each requirement and try again.",
    );
    expect(
      screen.getByRole("button", { name: "Continue to review" }),
    ).toBeEnabled();
  });

  test("continues directly when the server reports that no brief exists", async () => {
    const onNavigate = vi.fn();
    render(
      <RequirementsEditor
        reviewId={reviewId}
        initialRequirements={[]}
        skipTo={`/review/progress/${reviewId}`}
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Continuing to your review",
    );
    expect(onNavigate).toHaveBeenCalledWith(`/review/progress/${reviewId}`);
    expect(
      screen.queryByRole("button", { name: "Continue to review" }),
    ).not.toBeInTheDocument();
  });
});
