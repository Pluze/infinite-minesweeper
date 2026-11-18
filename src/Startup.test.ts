import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ textures: vi.fn(), init: vi.fn(), status: {textContent: ""} }));
vi.mock("./MobileLayout", () => ({setupMobileLayout: vi.fn()}));
vi.mock("./DensityHistory", () => ({trackDensity: vi.fn()}));
vi.mock("./ScorePlot", () => ({ScorePlot: vi.fn()}));
vi.mock("./Textures", () => ({loadTextures: mocks.textures}));
vi.mock("./FieldPersistence", () => ({FieldPersistence: class {
 loadLatest = async () => ({clickScores: [0], getAll: () => [], score: 0});
}}));
vi.mock("./FieldRenderer", () => ({FieldRenderer: class {init = mocks.init;}}));
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
it.each(["textures", "init"])("reports %s startup failure through the existing status", async (stage) => {
 vi.resetModules(); mocks.status.textContent = "";
 mocks.textures.mockReset().mockResolvedValue(undefined);
 mocks.init.mockReset().mockResolvedValue(undefined);
 mocks[stage as "textures" | "init"].mockRejectedValue(new Error("startup failure"));
 vi.stubGlobal("window", {localStorage: {}});
 vi.stubGlobal("self", {});
 vi.stubGlobal("document", {querySelector: () => mocks.status});
 vi.spyOn(console,"error").mockImplementation(() => {});
 await import("./index");
 await vi.waitFor(() => expect(mocks.status.textContent).toContain("Loading failed"));
});
