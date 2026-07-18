import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ReviewIntakeForm } from "./review-intake-form";

function words(count: number) {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReviewIntakeForm", () => {
  test("presents an editorial intake workspace and four-check acceptance rail", () => {
    render(<ReviewIntakeForm />);

    expect(
      screen.getByRole("heading", {
        name: "Review content before it leaves your desk",
      }),
    ).toBeInTheDocument();
    const rail = screen.getByRole("complementary", {
      name: "Acceptance pass",
    });
    for (const check of [
      "Brief fit",
      "Evidence & citations",
      "Editorial quality",
      "AI-writing risk",
    ]) {
      expect(within(rail).getByText(check)).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "Your content is not used to train general-purpose models. Anonymous uploads are deleted within 24 hours. Results are advisory and do not prove authorship.",
      ),
    ).toBeInTheDocument();
  });

  test("uses semantic paste/upload tabs and requires an explicit content type", () => {
    render(<ReviewIntakeForm />);

    const tabs = screen.getByRole("tablist", {
      name: "Article input method",
    });
    expect(within(tabs).getByRole("tab", { name: "Paste text" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(tabs).getByRole("tab", { name: "Upload file" }),
    ).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Blog post" })).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Review content" }),
    ).toBeDisabled();
  });

  test("supports keyboard navigation between source tabs", async () => {
    const user = userEvent.setup();
    render(<ReviewIntakeForm />);

    const pasteTab = screen.getByRole("tab", { name: "Paste text" });
    const uploadTab = screen.getByRole("tab", { name: "Upload file" });
    pasteTab.focus();
    await user.keyboard("{ArrowRight}");

    expect(uploadTab).toHaveFocus();
    expect(uploadTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(pasteTab).toHaveFocus();
    expect(pasteTab).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(uploadTab).toHaveFocus();

    await user.keyboard("{Home}");
    expect(pasteTab).toHaveFocus();
    expect(pasteTab).toHaveAttribute("aria-selected", "true");
  });

  test("accepts under-300-word text with a visible AI-risk warning", async () => {
    const user = userEvent.setup();
    render(<ReviewIntakeForm />);

    await user.type(screen.getByLabelText("Article text"), words(12));

    expect(screen.getByText("12 words")).toBeInTheDocument();
    expect(
      screen.getByText(
        "AI-writing risk won't be assessed for text under 300 words. The other checks will continue.",
      ),
    ).toBeInTheDocument();
  });

  test("announces the validation summary and blocks text over 5,000 words", async () => {
    const user = userEvent.setup();
    render(<ReviewIntakeForm />);

    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.click(screen.getByLabelText("Article text"));
    await user.paste(words(5_001));

    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent(
      "This review exceeds your 5,000-word per-document limit.",
    );
    expect(
      screen.getByRole("button", { name: "Review content" }),
    ).toBeDisabled();
  });

  test("shows supported upload formats and rejects an unsupported client-side selection", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ReviewIntakeForm />);

    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    expect(screen.getByText("PDF, DOCX, or UTF-8 TXT · 10 MB max")).toBeInTheDocument();
    expect(
      screen.getByText(/Word count is checked after upload/),
    ).toHaveTextContent("Documents under 300 words continue without AI-writing risk");

    await user.upload(
      screen.getByLabelText("Choose article file"),
      new File(["unsupported"], "article.rtf", { type: "application/rtf" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We can review PDF, DOCX, or TXT files.",
    );
  });

  test("clears the native file input when a selected file is removed", async () => {
    const user = userEvent.setup();
    render(<ReviewIntakeForm />);

    await user.click(screen.getByRole("tab", { name: "Upload file" }));
    const input = screen.getByLabelText("Choose article file");
    await user.upload(
      input,
      new File(["article"], "article.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(input).toHaveValue("");
    expect(screen.queryByText("article.txt")).not.toBeInTheDocument();
  });

  test("submits contentType, article, and optional brief then follows nextPath", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reviewId: "11111111-1111-4111-8111-111111111111",
          accessToken: "raw-access-token",
          nextPath:
            "/review/brief-confirmation?reviewId=11111111-1111-4111-8111-111111111111",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReviewIntakeForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText("Article text"), "Review title and body");
    await user.click(screen.getByRole("radio", { name: "Blog post" }));
    await user.click(
      screen.getByRole("button", { name: "Add a content brief (optional)" }),
    );
    await user.type(
      screen.getByLabelText("Content brief"),
      "Include a customer example.",
    );
    await user.click(screen.getByRole("button", { name: "Review content" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = request.body as FormData;
    expect(body.get("contentType")).toBe("blog_post");
    expect(body.get("bodyText")).toBe("Review title and body");
    expect(body.get("briefText")).toBe("Include a customer example.");
    expect(onCreated).toHaveBeenCalledWith(
      "/review/brief-confirmation?reviewId=11111111-1111-4111-8111-111111111111",
    );
  });
});
