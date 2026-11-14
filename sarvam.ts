import { SarvamAIClient } from "sarvamai";

const apiKey: string | undefined = process.env.SARVAM_API_KEY?.trim();
if (!apiKey) {
  throw new Error("Add SARVAM_API_KEY to .env before running this script.");
}

const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });

try {
  const response = await client.chat.completionsV2({
    model: "sarvam-105b",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
    max_tokens: 100,
  });
  console.log(response.choices[0]?.message.content);
} catch {
  console.error("Sarvam request failed. Check your API key and account access.");
  process.exitCode = 1;
}
