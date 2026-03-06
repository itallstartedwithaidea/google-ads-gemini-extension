import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const logDir = join(homedir(), ".gemini", "logs");
const logFile = join(logDir, "google-ads-agent.log");

try {
  mkdirSync(logDir, { recursive: true });

  const input = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input.push(chunk);
  }

  const data = JSON.parse(input.join(""));
  const toolName = data.toolName || "unknown";
  const timestamp = new Date().toISOString();
  const customerArg = data.input?.customer_id || "N/A";

  const entry = `[${timestamp}] tool=${toolName} customer=${customerArg}\n`;
  appendFileSync(logFile, entry);
} catch {
  // Silent fail — logging should never break the tool
}
