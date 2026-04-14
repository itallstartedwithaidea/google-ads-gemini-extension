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

<<<<<<< HEAD
    // Always output the data back to stdout
    process.stdout.write(inputData);

    const data = JSON.parse(inputData);
    const toolName = sanitize(data.toolName || data.tool_name || "unknown");
    const timestamp = new Date().toISOString();
    const customerArg = sanitize(data.input?.customer_id || "N/A");
=======
    process.stdout.write(inputData);

    const data = JSON.parse(inputData);
    const toolName = sanitize(data.tool_name || data.toolName || "unknown");
    const timestamp = new Date().toISOString();
    const customerArg = sanitize(data.tool_input?.customer_id || data.input?.customer_id || "N/A");
>>>>>>> f57ab3b (fix: hooks format + GAQL write protection + audit log field names)

    mkdirSync(logDir, { recursive: true });
    const entry = `[${timestamp}] tool=${toolName} customer=${customerArg}\n`;
    appendFileSync(logFile, entry);
  } catch (e) {
<<<<<<< HEAD
    // Ignore errors to avoid breaking the tool chain
=======
    // Pipe through even on parse failure so the tool chain isn't broken
    if (inputData) {
      try { process.stdout.write(inputData); } catch (_) {}
    }
>>>>>>> f57ab3b (fix: hooks format + GAQL write protection + audit log field names)
  }
}

main();
