// One-off diagnostic (do not commit): verify Gemini's OpenAI-compat endpoint
// supports the `tools` parameter — required before putting the google tier
// FIRST in the chatbot chain (chat uses native tool calling).
import "dotenv/config";

const key = process.env.GOOGLE_AI_API_KEY;
if (!key) {
  console.log("GOOGLE_AI_API_KEY not set");
  process.exit(0);
}

const res = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gemini-2.5-flash-lite",
      messages: [{ role: "user", content: "What time is it in Tokyo right now? Use the tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_time",
            description: "Get the current time for a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
      ],
      tool_choice: "auto",
      max_tokens: 100,
    }),
    signal: AbortSignal.timeout(30000),
  }
);

const body = await res.text();
console.log(`HTTP ${res.status}`);
if (res.ok) {
  const data = JSON.parse(body);
  const msg = data.choices?.[0]?.message;
  console.log("tool_calls =", JSON.stringify(msg?.tool_calls)?.slice(0, 300));
  console.log("content    =", JSON.stringify(msg?.content)?.slice(0, 120));
} else {
  console.log(body.slice(0, 400));
}
