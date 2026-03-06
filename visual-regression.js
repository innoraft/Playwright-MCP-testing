import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export class VisualRegressionChecker {
  /**
   * Creates an instance of VisualRegressionChecker.
   * @param {Object} options - Configuration options
   * @param {string} [options.baselineDir='files/baselines'] - Directory for baseline reference images
   * @param {string} [options.diffDir='files/diffs'] - Directory for diff output images
   * @param {number} [options.threshold=0.1] - Pixel-level sensitivity (0=strict, 1=loose)
   * @param {number} [options.failOnPercent=1.0] - Fail threshold if mismatch exceeds this percentage
   */
  constructor({
    baselineDir = 'files/baselines',
    diffDir = 'files/diffs',
    threshold = 0.1,       // pixel-level sensitivity: 0 = strict, 1 = loose
    failOnPercent = 1.0    // fail if mismatch > 1% of total pixels
  } = {}) {
    this.baselineDir = baselineDir;
    this.diffDir = diffDir;
    this.threshold = threshold;
    this.failOnPercent = failOnPercent;

    fs.mkdirSync(this.baselineDir, { recursive: true });
    fs.mkdirSync(this.diffDir, { recursive: true });
  }

  /**
   * Generates a safe baseline image file path from test name and breakpoint.
   * @param {string} testName - Name of the test
   * @param {string} breakpoint - Breakpoint identifier (e.g., "1280px")
   * 
   * @returns {string} Path to the baseline PNG file
   */
  getBaselinePath(testName, breakpoint) {
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBreakpoint = breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baselineDir, `${safeName}_${safeBreakpoint}.png`);
  }

  /**
   * Generates a safe diff image file path from test name and breakpoint.
   * @param {string} testName - Name of the test
   * @param {string} breakpoint - Breakpoint identifier (e.g., "1280px")
   * 
   * @returns {string} Path to the diff PNG file
   */
  getDiffPath(testName, breakpoint) {
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBreakpoint = breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.diffDir, `${safeName}_${safeBreakpoint}_diff.png`);
  }

  /**
   * Reads and parses a PNG file from disk.
   * @param {string} filePath - Path to the PNG file
   * 
   * @returns {PNG} Parsed PNG object with width, height, and data properties
   */
  readPNG(filePath) {
    const buffer = fs.readFileSync(filePath);
    return PNG.sync.read(buffer);
  }

  /**
   * Normalizes two PNG images to the same dimensions for comparison.
   * Crops both images to the smaller dimension to ensure valid pixel-by-pixel comparison.
   * @param {PNG} img1 - First PNG image
   * @param {PNG} img2 - Second PNG image
   * 
   * @returns {Object} Normalized images and dimensions
   * @returns {PNG} returns.img1 - Cropped first image
   * @returns {PNG} returns.img2 - Cropped second image
   * @returns {number} returns.width - Common width of normalized images
   * @returns {number} returns.height - Common height of normalized images
   */
  normalizeDimensions(img1, img2) {
    const width = Math.min(img1.width, img2.width);
    const height = Math.min(img1.height, img2.height);

    const crop = (img) => {
      const cropped = new PNG({ width, height });
      PNG.bitblt(img, cropped, 0, 0, width, height, 0, 0);
      return cropped;
    };

    return {
      img1: crop(img1),
      img2: crop(img2),
      width,
      height
    };
  }

  /**
   * Performs pixel-level comparison between reference and actual images using pixelmatch.
   * Generates a diff image highlighting mismatches and returns detailed comparison metrics.
   * @param {string} referencePath - Path to the baseline/reference image
   * @param {string} actualPath - Path to the current screenshot
   * @param {string} testName - Name of the test (for diff filename generation)
   * @param {string} breakpoint - Breakpoint identifier (e.g., "1280px")
   * 
   * @returns {Object} Comparison result object
   * @returns {boolean} returns.passed - Whether the visual comparison passed
   * @returns {number} returns.mismatchedPixels - Count of differing pixels
   * @returns {number} returns.mismatchPercent - Percentage of mismatched pixels
   * @returns {number} returns.totalPixels - Total pixels compared
   * @returns {number} returns.width - Image width used for comparison
   * @returns {number} returns.height - Image height used for comparison
   * @returns {string} returns.referencePath - Path to reference image
   * @returns {string} returns.actualPath - Path to actual screenshot
   * @returns {string} returns.diffPath - Path to generated diff image
   * @returns {string} returns.breakpoint - Breakpoint identifier
   * @returns {string} returns.summary - Human-readable comparison summary
   */
  compare(referencePath, actualPath, testName, breakpoint) {
    if (!fs.existsSync(referencePath)) {
      throw new Error(
        `Reference image not found at: ${referencePath}\nPlease place your reference image there manually.`
      );
    }
    if (!fs.existsSync(actualPath)) {
      throw new Error(`Actual screenshot not found at: ${actualPath}`);
    }

    const rawRef = this.readPNG(referencePath);
    const rawActual = this.readPNG(actualPath);

    // Normalize sizes so pixelmatch doesn't throw
    const { img1: ref, img2: actual, width, height } = this.normalizeDimensions(rawRef, rawActual);

    const diff = new PNG({ width, height });

    const mismatchedPixels = pixelmatch(
      ref.data,
      actual.data,
      diff.data,
      width,
      height,
      { threshold: this.threshold, includeAA: false } // includeAA: ignore anti-aliasing
    );

    // Save diff image
    const diffPath = this.getDiffPath(testName, breakpoint);
    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    const totalPixels = width * height;
    const mismatchPercent = (mismatchedPixels / totalPixels) * 100;
    const passed = mismatchPercent <= this.failOnPercent;

    return {
      passed,
      mismatchedPixels,
      mismatchPercent: parseFloat(mismatchPercent.toFixed(4)),
      totalPixels,
      width,
      height,
      referencePath,
      actualPath,
      diffPath,
      breakpoint,
      summary: passed
        ? `✅ Visual match passed (${mismatchPercent.toFixed(2)}% mismatch)`
        : `❌ Visual mismatch detected (${mismatchPercent.toFixed(2)}% > ${this.failOnPercent}% threshold)`
    };
  }

  /**
   * Runs a complete visual regression test step by comparing a screenshot to its baseline.
   * Throws an error if no baseline exists — manual baseline creation is required.
   * @param {string} testName - Name of the test
   * @param {string} breakpoint - Breakpoint identifier (e.g., "1280px")
   * @param {string} screenshotPath - Path to the current screenshot to compare
   * 
   * @returns {Object} Comparison result object with pass/fail status and metrics
   * @throws {Error} If reference image does not exist at the expected path
   */
  runRegressionStep(testName, breakpoint, screenshotPath) {
    const baselinePath = this.getBaselinePath(testName, breakpoint);

    if (!fs.existsSync(baselinePath)) {
      throw new Error(
        `No reference image found at: ${baselinePath}\nPlease place your reference image there manually.`
      );
    }

    return this.compare(baselinePath, screenshotPath, testName, breakpoint);
  }
}
