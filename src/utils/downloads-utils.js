// Helpers for separating MCP's own generated output (screenshots/pdfs) from real browser downloads.
import fs from "fs";
import path from "path";

// MCP always names its own screenshot/PDF/trace output "page-<ISO timestamp>.<ext>" or "step-<n>-...".
// Anything else in the output dir is a real browser download (any file type: image, video, pdf, zip...).
export const MCP_GENERATED_FILE_RE = /^(?:page-\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}-\d{3}z|step-\d+-[^.]+)\.[a-z0-9]+$/i;

function collectDownloadedFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectDownloadedFiles(entryPath);
    }

    return MCP_GENERATED_FILE_RE.test(entry.name) ? [] : [entryPath];
  });
}

/**
 * The MCP server saves every file it produces (screenshots, PDFs and
 * browser downloads) into the same --output-dir. Move anything that
 * isn't MCP's own generated output into the given downloads directory so
 * downloaded files show up where users expect them, regardless of file type.
 *
 * @param {string} outputDir - Directory MCP writes screenshots/downloads into
 * @param {string} downloadsDir - Destination directory for real downloads
 * @param {string} [workspaceDir] - Used only to shorten the logged path; defaults to cwd
 */
export function moveDownloadedFiles(outputDir, downloadsDir, workspaceDir = process.cwd()) {
  try {
    const downloadedFiles = collectDownloadedFiles(outputDir);

    if (downloadedFiles.length === 0) return;

    fs.mkdirSync(downloadsDir, { recursive: true });

    for (const filePath of downloadedFiles) {
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      let destPath = path.join(downloadsDir, `${base}${ext}`);
      let suffix = 1;
      while (fs.existsSync(destPath)) {
        destPath = path.join(downloadsDir, `${base}_${suffix}${ext}`);
        suffix += 1;
      }
      fs.renameSync(filePath, destPath);
      console.log(`  📥 Download saved: ${path.relative(workspaceDir, destPath)}`);
    }
  } catch (err) {
    console.error(`  ⚠️ Failed to move downloaded files:`, err.message ?? err);
  }
}
