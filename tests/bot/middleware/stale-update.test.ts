import { describe, expect, it, vi } from "vitest";
import { staleUpdateMiddleware } from "../../../src/bot/middleware/stale-update.js";
import type { Context } from "../../../src/max/compat.js";

function createContext(ageSeconds: number): Context {
  return {
    message: {
      message_id: "1",
      date: Math.floor(Date.now() / 1000) - ageSeconds,
      chat: { id: 42, type: "private" },
    },
    chat: { id: 42, type: "private" },
  } as unknown as Context;
}

describe("staleUpdateMiddleware", () => {
  it("passes a fresh message to the next middleware", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await staleUpdateMiddleware(createContext(5), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("drops a message older than the stale window", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await staleUpdateMiddleware(createContext(120), next);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes a message dated in the future when clocks drift", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await staleUpdateMiddleware(createContext(-30), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes non-message updates", async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    await staleUpdateMiddleware({ callbackQuery: { id: "1" } } as unknown as Context, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
