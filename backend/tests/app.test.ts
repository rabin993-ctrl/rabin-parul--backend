import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { authPlugin } from "../src/plugins/auth.js";

describe("auth plugin registration", () => {
  it("exposes authentication hooks to routes registered afterward", async () => {
    const app = Fastify();
    await app.register(authPlugin);
    app.get("/protected", { preHandler: app.authenticate }, async () => ({
      ok: true,
    }));

    const response = await app.inject({ method: "GET", url: "/protected" });

    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
