import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsView from "@/components/docs/docs-view";

describe("DocsView", () => {
  it("renders the README window with kicker and title", () => {
    render(<DocsView />);

    expect(screen.getByTestId("docs-window")).toBeTruthy();
    expect(screen.getByText("DYNIX TRACE — DOCUMENTATION")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.getByText("README · workflow")).toBeTruthy();
  });

  it("walks through all six workflow stages", () => {
    render(<DocsView />);

    for (const title of ["Start", "Collect", "Normalize", "Inspect", "Rules", "Report"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(screen.getByText("06")).toBeTruthy();
  });

  it("documents the deterministic rules and risk bands", () => {
    render(<DocsView />);

    expect(screen.getByText("R1")).toBeTruthy();
    expect(screen.getByText("Masquerading system binary")).toBeTruthy();
    expect(screen.getByText("R2")).toBeTruthy();
    expect(screen.getByText("Unsigned in user-writable location")).toBeTruthy();
    expect(screen.getByText("R3")).toBeTruthy();
    expect(screen.getByText("Executable in temp")).toBeTruthy();

    expect(screen.getByText("Moderate")).toBeTruthy();
    expect(screen.getByText("15–39")).toBeTruthy();
    expect(screen.getByText("70–100")).toBeTruthy();
  });

  it("keeps the honest limits visible", () => {
    render(<DocsView />);

    expect(screen.getByText("Running processes only — this is not a full-machine scan.")).toBeTruthy();
    expect(screen.getByText("The score is a heuristic, not a verdict.")).toBeTruthy();
    expect(
      screen.getByText("The backend is local and loopback-only — scan data never leaves this machine."),
    ).toBeTruthy();
  });

  it("lists the local API endpoints", () => {
    render(<DocsView />);

    expect(screen.getByText("/api/scanner/scans/:id/events")).toBeTruthy();
    expect(screen.getByText("/api/scanner/scans/:id/report")).toBeTruthy();
  });
});
