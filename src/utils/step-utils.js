// Generic step-list helpers shared by OpenAI-Agents-SDK runners.

/**
 * Splits steps into chunks of specified size.
 */
export function chunkSteps(steps, chunkSize) {
  const chunks = [];
  for (let i = 0; i < steps.length; i += chunkSize) {
    chunks.push(steps.slice(i, i + chunkSize));
  }
  return chunks;
}

export function getUserFriendlyStepFailure(errorMessage) {
  const message = String(errorMessage || "").toLowerCase();

  if (message.includes("timeout")) {
    return "The page took too long to respond. Check your internet connection or confirm that the page and requested element are available.";
  }
  if (message.includes("locator") || message.includes("selector") || message.includes("not found")) {
    return "The requested element could not be found on the page. Check that the page loaded correctly and that the element details are accurate.";
  }
  if (message.includes("navigation") || message.includes("net::err_")) {
    return "The browser could not open or load the requested page. Check that the URL is correct and reachable.";
  }
  if (message.includes("download")) {
    return "The file could not be downloaded. Check that the download link is available and that the server returned the file.";
  }

  return "The browser could not complete this step. Check the page state, requested action, and any data supplied to the step.";
}
