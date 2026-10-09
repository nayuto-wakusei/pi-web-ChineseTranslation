import { expect, it } from "vitest";
import { FEDERATED_HTTP_ROUTES } from "./federatedRoutes.js";

it.each([
  ["GET", "tree"],
  ["GET", "file"],
  ["PUT", "file"],
  ["DELETE", "file"],
  ["POST", "file/move"],
])("bounds and cancels federated %s %s requests", (method, resource) => {
  expect(FEDERATED_HTTP_ROUTES.find((route) => route.method === method
    && route.path === `/projects/:projectId/workspaces/:workspaceId/${resource}`)).toMatchObject({
    timeoutMs: 30_000,
    responseBodyLimit: 32 * 1024 * 1024,
    propagateCancellation: true,
  });
});

it("propagates cancellation to paired plugin requests", () => {
  expect(FEDERATED_HTTP_ROUTES.find((route) => route.path.startsWith("/paired-plugin-backends/")))
    .toMatchObject({ propagateCancellation: true });
});
