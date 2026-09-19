import { describe, expect, test } from "bun:test";
import { instanceAuthFromEnv, unwrapScriptedRest } from "../../../packages/mcp-server/src/gateway/instance";

describe("unwrapScriptedRest", () => {
  test("unwraps Scripted REST { result: payload }", () => {
    expect(unwrapScriptedRest({ result: { results: [{ id: "sn.me.work" }] } })).toEqual({
      results: [{ id: "sn.me.work" }],
    });
  });

  test("parses a stringified result body", () => {
    expect(unwrapScriptedRest({ result: '{"outcome":"ok"}' })).toEqual({ outcome: "ok" });
  });

  test("leaves a native kernel payload alone", () => {
    const native = { results: [{ id: "x" }], result: "keep" };
    expect(unwrapScriptedRest(native)).toEqual(native);
  });
});

describe("instanceAuthFromEnv", () => {
  test("prefers HTTP Basic when user+password are set", () => {
    const auth = instanceAuthFromEnv({
      SNOW_USER: "opennow-mcp",
      SNOW_PASSWORD: "secret",
      SNOW_ACCESS_TOKEN: "ignored",
    } as NodeJS.ProcessEnv);
    expect(auth.basic).toEqual({ username: "opennow-mcp", password: "secret" });
    expect(auth.tokenProvider).toBeUndefined();
  });

  test("falls back to a bearer token", async () => {
    const auth = instanceAuthFromEnv({ SNOW_ACCESS_TOKEN: "tok" } as NodeJS.ProcessEnv);
    expect(auth.basic).toBeUndefined();
    expect(await auth.tokenProvider?.()).toBe("tok");
  });
});
