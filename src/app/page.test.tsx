import { beforeEach, expect, test, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import Home from "./page";

beforeEach(() => {
  redirectMock.mockClear();
});

test("sends the root route to the acceptance review workspace", () => {
  Home();

  expect(redirectMock).toHaveBeenCalledWith("/review");
});
