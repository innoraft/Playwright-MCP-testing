import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export class VisualRegressionChecker {
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
   * Generates a safe filename from testName + breakpoint.
   */
  getBaselinePath(testName, breakpoint) {
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBreakpoint = breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baselineDir, `${safeName}_${safeBreakpoint}.png`);
  }

  getDiffPath(testName, breakpoint) {
    const safeName = testName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeBreakpoint = breakpoint.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.diffDir, `${safeName}_${safeBreakpoint}_diff.png`);
  }

  /**
   * Reads and parses a PNG file into a PNG object.
   */
  readPNG(filePath) {
    const buffer = fs.readFileSync(filePath);
    return PNG.sync.read(buffer);
  }

  /**
   * Resizes the smaller image to match the larger one's dimensions
   * by cropping or padding — keeps comparison valid.
   * Simple approach: crop both to the smaller dimension.
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
   * Core comparison using pixelmatch.
   *
   * @param {string} referencePath - Baseline image path
   * @param {string} actualPath    - Current screenshot path
   * @param {string} testName      - For diff filename generation
   * @param {string} breakpoint    - e.g. "1280px"
   * @returns {ComparisonResult}
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
   * Full regression step: compare or create baseline.
   *
   * @param {string} testName
   * @param {string} breakpoint
   * @param {string} screenshotPath
   * @param {boolean} updateBaselines
   * @returns {ComparisonResult}
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
