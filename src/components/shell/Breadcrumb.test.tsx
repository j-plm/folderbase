import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavigationContext } from "../../contexts/NavigationContext";
import type { NavigationState } from "../../types/navigation";
import Breadcrumb from "./Breadcrumb";
import type { ReactNode } from "react";

function makeCtx(overrides: Partial<NavigationState>): NavigationState {
  return {
    activeLocationId: null,
    activeViewId: "v1",
    path: [],
    viewMode: "tiles",
    views: [],
    viewNodes: [],
    currentLibrary: null,
    editStructure: false,
    masterEditorOpen: false,
    navigateTo: vi.fn(),
    pushSegment: vi.fn(),
    popToIndex: vi.fn(),
    setViewMode: vi.fn(),
    setActiveLocation: vi.fn(),
    setActiveView: vi.fn(),
    setEditStructure: vi.fn(),
    openMasterEditor: vi.fn(),
    closeMasterEditor: vi.fn(),
    refreshViews: vi.fn(),
    refreshViewNodes: vi.fn(),
    ...overrides,
  };
}

function Wrapper({ ctx, children }: { ctx: NavigationState; children: ReactNode }) {
  return <NavigationContext.Provider value={ctx}>{children}</NavigationContext.Provider>;
}

describe("Breadcrumb", () => {
  it("renders one crumb (view name) for empty path", () => {
    const ctx = makeCtx({ path: [] });
    render(<Wrapper ctx={ctx}><Breadcrumb viewName="Photos" /></Wrapper>);
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.queryAllByText("/")).toHaveLength(0);
  });

  it("renders correct number of crumbs for 3-segment path", () => {
    const ctx = makeCtx({ path: ["2023", "05", "Canon"] });
    render(<Wrapper ctx={ctx}><Breadcrumb viewName="Photos" /></Wrapper>);
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.getByText("2023")).toBeInTheDocument();
    expect(screen.getByText("05")).toBeInTheDocument();
    expect(screen.getByText("Canon")).toBeInTheDocument();
  });

  it("clicking a non-final crumb calls popToIndex with correct index", async () => {
    const popToIndex = vi.fn();
    const ctx = makeCtx({ path: ["2023", "05"], popToIndex });
    render(<Wrapper ctx={ctx}><Breadcrumb viewName="Photos" /></Wrapper>);
    await userEvent.click(screen.getByRole("button", { name: "2023" }));
    expect(popToIndex).toHaveBeenCalledWith(1);
  });

  it("the last crumb is not a button", () => {
    const ctx = makeCtx({ path: ["2023"] });
    render(<Wrapper ctx={ctx}><Breadcrumb viewName="Photos" /></Wrapper>);
    expect(screen.queryByRole("button", { name: "2023" })).toBeNull();
    expect(screen.getByText("2023")).toBeInTheDocument();
  });
});
