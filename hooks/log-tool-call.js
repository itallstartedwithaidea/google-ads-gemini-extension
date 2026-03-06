import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function sanitize(val) {
  return String(val).replace(/[\r\n\t\x00-\x1f]/g, "_").slice(0, 200);
}

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
  const toolName = sanitize(data.toolName || "unknown");
  const timestamp = new Date().toISOString();
  const customerArg = sanitize(data.input?.customer_id || "N/A");

  const entry = `[${timestamp}] tool=${toolName} customer=${customerArg}\n`;
  appendFileSync(logFile, entry);
} catch {
  // Silent fail — logging should never break tool execution
}
