import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../../src/max/compat.js";
import type { VoiceMessageDeps } from "../../../src/bot/handlers/voice-handler.js";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const mocked = vi.hoisted(() => ({
  getTtsModeMock: vi.fn(),
  getPromptQueueModeMock: vi.fn(),
  flushPendingPromptMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getTtsMode: mocked.getTtsModeMock,
  getPromptQueueMode: mocked.getPromptQueueModeMock,
  getCurrentSession: vi.fn(() => undefined),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: mocked.flushPendingPromptMock,
  __resetMessageMergerForTests: vi.fn(),
}));

async function loadVoiceModule() {
  vi.resetModules();
  return import("../../../src/bot/handlers/voice-handler.js");
}

function createVoiceContext(): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
  editMessageTextMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: "101" });
  const editMessageTextMock = vi.fn().mockResolvedValue(true);

  const ctx = {
    chat: { id: 777 },
    message: {
      voice: {
        file_id: "voice-file-id",
      },
    },
    reply: replyMock,
    api: {
      editMessageText: editMessageTextMock,
    },
  } as unknown as Context;

  return { ctx, replyMock, editMessageTextMock };
}

function createVoiceDeps(overrides: Record<string, unknown> = {}): {
  deps: VoiceMessageDeps;
  processPromptMock: ReturnType<typeof vi.fn>;
  downloadMock: ReturnType<typeof vi.fn>;
  transcribeMock: ReturnType<typeof vi.fn>;
} {
  const processPromptMock = vi.fn().mockResolvedValue(true);
  const downloadMock = vi.fn().mockResolvedValue({
    buffer: Buffer.from("audio"),
    filename: "file_1.oga",
  });
  const transcribeMock = vi.fn().mockResolvedValue({ text: "run tests" });

  const deps: VoiceMessageDeps = {
    ...createTestAppContainer(),
    bot: {} as VoiceMessageDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    isSttConfigured: vi.fn(() => true),
    downloadMAXFile: downloadMock,
    transcribeAudio: transcribeMock,
    processPrompt: (ctx, input, promptDeps, options) =>
      processPromptMock(ctx, input.text, promptDeps, input.fileParts, options),
    ...overrides,
  };
  return { deps, processPromptMock, downloadMock, transcribeMock };
}

describe("bot/handlers/voice-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getTtsModeMock.mockReturnValue("off");
    mocked.getPromptQueueModeMock.mockReturnValue("off");
    vi.doUnmock("node:https");
    vi.stubEnv("MAX_BOT_TOKEN", "test-max-token");
    vi.stubEnv("MAX_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("MAX_API_ROOT", "");
    vi.stubEnv("STT_NOTE_PROMPT", "");
  });

  it("edits the status message with quoted recognized text", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "Line 1\nLine 2" }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(editMessageTextMock).toHaveBeenCalledWith(
      777,
      "101",
      "🎤 Recognized:\n> Line 1\n> Line 2",
      undefined,
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "Line 1\nLine 2", deps, [], {
      responseMode: "text_only",
    });
  });

  it("transcribes and queues a voice message while the agent is busy", async () => {
    mocked.getPromptQueueModeMock.mockReturnValue("queue");
    const { handleVoiceMessage } = await loadVoiceModule();
    const { promptQueue } = await import("../../../src/app/managers/prompt-queue-manager.js");
    const { initializePromptQueueDispatch } = await import(
      "../../../src/bot/handlers/prompt-queue-dispatch.js"
    );
    // The module graph was reset above, so the container has to come from it as well.
    const { createTestAppContainer: createFreshTestAppContainer } = await import(
      "../../helpers/app-container.js"
    );
    const container = createFreshTestAppContainer();
    promptQueue.__resetForTests();
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const { ctx } = createVoiceContext();
    const { deps: baseDeps, processPromptMock, transcribeMock } = createVoiceDeps();
    const deps = { ...baseDeps, ...container };
    initializePromptQueueDispatch(deps);

    await handleVoiceMessage(ctx, deps);

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(processPromptMock).not.toHaveBeenCalled();
    expect(promptQueue.list()).toEqual([
      expect.objectContaining({
        text: "run tests",
        displayText: "run tests",
        responseMode: "text_only",
      }),
    ]);
    expect(promptQueue.mediaSize()).toBe(0);
  });

  it("continues with prompt processing when recognized text message edit fails", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    editMessageTextMock.mockRejectedValueOnce(new Error("message is too long"));

    await handleVoiceMessage(ctx, deps);

    expect(mocked.flushPendingPromptMock).toHaveBeenCalledWith(777);
    expect(replyMock).toHaveBeenCalledWith(t("stt.recognizing"));
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
      responseMode: "text_only",
    });
  });

  it("returns not-configured message and does not process prompt", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, replyMock } = createVoiceContext();
    const { deps, processPromptMock, downloadMock } = createVoiceDeps({
      isSttConfigured: () => false,
    });

    await handleVoiceMessage(ctx, deps);

    expect(replyMock).toHaveBeenCalledWith(t("stt.not_configured"));
    expect(downloadMock).not.toHaveBeenCalled();
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("shows empty-result message and skips prompt processing", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx, editMessageTextMock } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps({
      transcribeAudio: vi.fn().mockResolvedValue({ text: "   " }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(editMessageTextMock).toHaveBeenCalledWith(777, "101", t("stt.empty_result"));
    expect(processPromptMock).not.toHaveBeenCalled();
  });

  it("adds STT note to the LLM prompt when STT_NOTE_PROMPT is set", async () => {
    vi.stubEnv(
      "STT_NOTE_PROMPT",
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.",
    );

    const { handleVoiceMessage } = await loadVoiceModule();
    const { logger } = await import("../../../src/utils/logger.js");
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();
    const note =
      "The following text is transcribed from voice. It may contain phonetic errors. Infer the intended meaning from context.";

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(ctx, `[Note: ${note}]\nrun tests`, deps, [], {
      responseMode: "text_only",
    });
    expect(logger.debug).toHaveBeenCalledWith(
      `[Voice] Added STT note to LLM prompt: [Note: ${note}]`,
    );
  });

  it("requests an audio reply for voice prompts when TTS mode is auto", async () => {
    mocked.getTtsModeMock.mockReturnValue("auto");
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx } = createVoiceContext();
    const { deps, processPromptMock } = createVoiceDeps();

    await handleVoiceMessage(ctx, deps);

    expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
      responseMode: "text_and_tts",
    });
  });

  it.each(["", "false", "0", "   "])(
    "does not add STT note when STT_NOTE_PROMPT is %j",
    async (notePrompt) => {
      vi.stubEnv("STT_NOTE_PROMPT", notePrompt);

      const { handleVoiceMessage } = await loadVoiceModule();
      const { logger } = await import("../../../src/utils/logger.js");
      const { ctx } = createVoiceContext();
      const { deps, processPromptMock } = createVoiceDeps();

      await handleVoiceMessage(ctx, deps);

      expect(processPromptMock).toHaveBeenCalledWith(ctx, "run tests", deps, [], {
        responseMode: "text_only",
      });
      expect(logger.debug).not.toHaveBeenCalled();
    },
  );

  it("downloads the URL returned by MAX getFile", async () => {
    const { handleVoiceMessage } = await loadVoiceModule();
    const { ctx } = createVoiceContext();
    const getFileMock = vi.fn().mockResolvedValue({
      file_path: "https://cdn.example/voice/file_123.oga",
      file_size: 5,
    });
    (ctx.api as unknown as { getFile: typeof getFileMock }).getFile = getFileMock;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("audio"), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { deps, processPromptMock } = createVoiceDeps({
      downloadMAXFile: undefined,
      transcribeAudio: vi.fn().mockResolvedValue({ text: "hello" }),
    });

    await handleVoiceMessage(ctx, deps);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example/voice/file_123.oga",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(processPromptMock).toHaveBeenCalledWith(ctx, "hello", deps, [], {
      responseMode: "text_only",
    });
  });
});
