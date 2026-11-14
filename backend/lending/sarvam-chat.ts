import { SarvamAIClient } from "sarvamai";

const apiSubscriptionKey: string | undefined = process.env.SARVAM_API_KEY;
if (!apiSubscriptionKey?.trim()) {
  console.error("Paste your SARVAM_API_KEY into the root .env file first.");
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey });
try {
  const response = await client.chat.completions({
    model: "sarvam-105b-conversations",
    messages: [{ role: "user", content: "Say hello in one short sentence." }],
  });
  const reply = response.choices[0]?.message.content;
  if (!reply?.trim()) throw new Error("Empty response");
  console.log(reply);
} catch {
  console.error("Sarvam chat request failed.");
  process.exitCode = 1;
}
