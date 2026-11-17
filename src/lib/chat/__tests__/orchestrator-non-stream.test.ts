// Buffered tool-calling loop (runChatTurn): malformed tool arguments must be
// handled exactly like the streaming loop — the tool is NOT executed and the
// model gets a tool result telling it to retry with valid JSON.

jest.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = async () => [];
  return { db: { select: () => chain } };
});

jest.mock("../llm", () => ({
  chatCompletion: jest.fn(),
  chatCompletionStream: jest.fn(),
}));

jest.mock("../tools", () => ({
  CHAT_TOOLS: [],
  CHAT_TOOLS_OPENAI_FORMAT: [],
  executeChatTool: jest.fn(async () => ({ price: 64000 })),
}));

import { runChatTurn } from "../orchestrator";
import { chatCompletion, type ChatMessage } from "../llm";
import { executeChatTool } from "../tools";

const completionMock = chatCompletion as jest.Mock;
const toolMock = executeChatTool as jest.Mock;

function assistantToolCall(argumentsJson: string) {
  return {
    provider: "google",
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_live_price", arguments: argumentsJson },
        },
      ],
    },
  };
}

function textReply(content: string) {
  return { provider: "google", message: { role: "assistant", content, tool_calls: [] } };
}

/** Messages of the Nth chatCompletion call (0-based). */
function messagesOfCall(index: number): ChatMessage[] {
  return completionMock.mock.calls[index][0].messages as ChatMessage[];
}

beforeEach(() => {
  completionMock.mockReset();
  toolMock.mockClear();
});

describe("runChatTurn tool-argument handling", () => {
  it("does not execute a tool with malformed arguments and asks the model to retry", async () => {
    completionMock
      .mockResolvedValueOnce(assistantToolCall('{"symbol":"BT')) // truncated JSON
      .mockResolvedValueOnce(textReply("Xin lỗi, thử lại giúp mình."));

    const result = await runChatTurn("session-1", "giá BTC?");

    expect(toolMock).not.toHaveBeenCalled();
    const retryMessages = messagesOfCall(1);
    const toolMessage = retryMessages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(JSON.parse(String(toolMessage!.content))).toEqual({
      error: "Malformed tool arguments; call the tool again with valid JSON.",
    });
    expect(result).toMatchObject({ reply: "Xin lỗi, thử lại giúp mình.", toolCalls: [] });
  });

  it("executes the tool with parsed arguments when the JSON is valid", async () => {
    completionMock
      .mockResolvedValueOnce(assistantToolCall('{"symbol":"BTC"}'))
      .mockResolvedValueOnce(textReply("BTC đang ở 64k."));

    const result = await runChatTurn("session-1", "giá BTC?");

    expect(toolMock).toHaveBeenCalledWith("get_live_price", { symbol: "BTC" });
    const toolMessage = messagesOfCall(1).find((m) => m.role === "tool");
    expect(JSON.parse(String(toolMessage!.content))).toEqual({ price: 64000 });
    expect(result).toMatchObject({
      reply: "BTC đang ở 64k.",
      toolCalls: [{ name: "get_live_price", latencyMs: expect.any(Number) }],
    });
  });

  it("returns the text answer directly when the model calls no tools", async () => {
    completionMock.mockResolvedValueOnce(textReply("Chào bạn."));

    const result = await runChatTurn("session-1", "hi");

    expect(toolMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reply: "Chào bạn.", toolCalls: [] });
  });
});
