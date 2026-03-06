import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function sanitize(val) {
  return String(val || "").replace(/[\r\n\t\x00-\x1f]/g, "_").slice(0, 200);
}

const logDir = join(homedir(), ".gemini", "logs");
const logFile = join(logDir, "google-ads-agent.log");

async function main() {
  let inputData = "";
  try {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    if (!inputData) {
      return;
    }

    // Always output the data back to stdout
    process.stdout.write(inputData);

    const data = JSON.parse(inputData);
    const toolName = sanitize(data.toolName || data.tool_name || "unknown");
    const timestamp = new Date().toISOString();
    const customerArg = sanitize(data.input?.customer_id || "N/A");

    mkdirSync(logDir, { recursive: true });
    const entry = `[${timestamp}] tool=${toolName} customer=${customerArg}\n`;
    appendFileSync(logFile, entry);
  } catch (e) {
    // Ignore errors to avoid breaking the tool chain
  }
}

main();
