import { describe, expect, test } from "bun:test";
import { SessionStore, SessionTokenProvider } from "@open-now/mcp-server";

describe("session store", () => {
  test("create/get/delete roundtrips a session", () => {
    const store = new SessionStore();
    store.create({
      sessionId: "s1",
      userSysId: "u_ada",
      userName: "Ada",
      accessToken: "instance-token",
      refreshToken: "refresh-1",
      createdAt: new Date().toISOString(),
    });
    const rec = store.get("s1");
    expect(rec?.userSysId).toBe("u_ada");
    expect(rec?.userName).toBe("Ada");
    expect(rec?.accessToken).toBe("instance-token");
    expect(rec?.refreshToken).toBe("refresh-1");
    store.delete("s1");
    expect(store.get("s1")).toBeNull();
    store.close();
  });

  test("token provider resolves through the session id", async () => {
    const store = new SessionStore();
    store.create({
      sessionId: "s2",
      userSysId: "u_ada",
      userName: "Ada",
      accessToken: "tok-2",
      createdAt: new Date().toISOString(),
    });
    const provider = new SessionTokenProvider(store, () => "s2");
    expect(await provider.token()).toBe("tok-2");
    expect(await new SessionTokenProvider(store, () => "nope").token()).toBeNull();
    expect(await new SessionTokenProvider(store, () => undefined).token()).toBeNull();
    store.close();
  });
});
