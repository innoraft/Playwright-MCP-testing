// Screenshot discovery/encoding helpers shared by OpenAI-Agents-SDK runners.
import fs from "fs";
import path from "path";

export function toDataUriFromPng(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const imgBuffer = fs.readFileSync(filePath);
    return `data:image/png;base64,${imgBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export function listScreenshotsWithMtime(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".png"))
    .map((f) => {
      const fullPath = path.join(outputDir, f);
      return {
        name: f,
        fullPath,
        mtime: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => a.mtime - b.mtime);
}

export function parseStepNumberFromScreenshotName(fileName) {
  if (!fileName) return null;
  const match = fileName.match(/(?:^|[_-])step[_-]?(\d+)(?:[_-]|\.|$)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Groups screenshots freshly written to `outputDir` (since `chunkStartMs`) by step number,
 * matching filenames like "step-3-...png" first, then falling back to positional assignment
 * for screenshots that don't encode a step number in their name.
 */
export function collectChunkScreenshotsByStep(outputDir, chunkStartMs, chunkStepNumbers) {
  const byStep = new Map();
  const chunkSet = new Set(chunkStepNumbers);
  const fresh = listScreenshotsWithMtime(outputDir).filter((f) => f.mtime >= chunkStartMs);
  const unassigned = [];

  for (const file of fresh) {
    const uri = toDataUriFromPng(file.fullPath);
    if (!uri) continue;
    const parsedStep = parseStepNumberFromScreenshotName(file.name);
    if (parsedStep && chunkSet.has(parsedStep)) {
      const arr = byStep.get(parsedStep) ?? [];
      arr.push(uri);
      byStep.set(parsedStep, arr);
    } else {
      unassigned.push(uri);
    }
  }

  // Fallback assignment for screenshots without step-based filename.
  if (unassigned.length > 0) {
    let cursor = 0;
    for (const stepNum of chunkStepNumbers) {
      if (cursor >= unassigned.length) break;
      const arr = byStep.get(stepNum) ?? [];
      if (arr.length === 0) {
        arr.push(unassigned[cursor]);
        cursor += 1;
        byStep.set(stepNum, arr);
      }
    }
  }

  return byStep;
}

/**
 * Try to find a screenshot file from the output directory for the most recent capture.
 */
export function findLatestScreenshot(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) return null;
    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(outputDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const latestPath = path.join(outputDir, files[0].name);
    const imgBuffer = fs.readFileSync(latestPath);
    return `data:image/png;base64,${imgBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Programmatic screenshot capture as fallback when an agent doesn't take one.
 * `server` must expose a `callTool(name, args)` method (e.g. MCPServerSdkStdio).
 * Returns base64 data URI or null.
 */
export async function captureFailureScreenshot(server) {
  try {
    console.log(`  📸 Taking fallback failure screenshot...`);
    const result = await server.callTool("browser_take_screenshot", {});
    const content = result?.content ?? result;

    if (Array.isArray(content)) {
      for (const item of content) {
        // MCP screenshot returns image as base64 in the content
        if (item.type === "image" && item.data) {
          return `data:${item.mimeType || "image/png"};base64,${item.data}`;
        }
      }
      // Sometimes the screenshot path is returned as text
      for (const item of content) {
        if (item.type === "text" && item.text) {
          // Check if MCP saved a file — read it and convert to base64
          const match = item.text.match(/Screenshot saved to[:\s]+(.+\.png)/i);
          if (match) {
            const screenshotPath = match[1].trim();
            if (fs.existsSync(screenshotPath)) {
              const imgBuffer = fs.readFileSync(screenshotPath);
              return `data:image/png;base64,${imgBuffer.toString("base64")}`;
            }
          }
        }
      }
    }

    return null;
  } catch (err) {
    console.error(`  ⚠️ Failed to capture fallback screenshot:`, err.message ?? err);
    return null;
  }
}
