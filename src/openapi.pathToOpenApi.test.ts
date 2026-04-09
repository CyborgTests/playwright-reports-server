import { describe, expect, it } from "vitest";

import { pathToOpenApi } from "./openapi";

describe("pathToOpenApi", () => {
  it("maps a single :param to {param}", () => {
    expect(pathToOpenApi("/api/report/:id")).toBe("/api/report/{id}");
  });

  it("maps multiple params", () => {
    expect(pathToOpenApi("/api/serve/:project/:reportId")).toBe("/api/serve/{project}/{reportId}");
  });

  it("leaves paths without params unchanged", () => {
    expect(pathToOpenApi("/api/ping")).toBe("/api/ping");
  });
});
