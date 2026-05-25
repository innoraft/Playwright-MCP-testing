/**
 * System prompt and user message builder for AI-powered Lighthouse fix suggestions.
 *
 * Used after Lighthouse audits complete to analyze failing audits across all
 * categories and return concise, developer-friendly fix suggestions.
 * The output is embedded as the "AI Suggestions" tab in the HTML report.
 */

/**
 * Returns the system prompt for the AI fix-suggestion call.
 * Kept lean so it fits inside a short token budget.
 *
 * @returns {string}
 */
export function buildPerfSuggestionsSystemPrompt() {
  return `You are a web-performance and quality expert specialising in Lighthouse audits. \
You will receive a list of FAILING or LOW-SCORING Lighthouse audit items grouped by category. \
Your job is to suggest concrete, actionable developer fixes.

## STRICT RULES
- Each suggestion must be 1-3 sentences max. Be direct and specific.
- Focus on HOW to fix it, not what it is.
- Do NOT repeat the audit title in the suggestion — go straight to the fix.
- Provide at most 5 suggestions per category.
- Output ONLY a valid JSON object — no markdown fences, no extra prose.
- Only include categories that actually have failing audits.

## OUTPUT FORMAT
{
  "performance": [
    "Compress and serve images in WebP/AVIF format using Next.js Image or a CDN image pipeline.",
    "Defer non-critical JavaScript by adding async/defer attributes or moving scripts to the bottom of <body>."
  ],
  "accessibility": [
    "Add descriptive alt text to every <img> element, especially hero images and icons."
  ],
  "best-practices": [
    "Migrate all HTTP asset references to HTTPS to eliminate mixed-content warnings."
  ],
  "seo": [
    "Add a unique, keyword-rich <meta name=\\"description\\"> tag under 160 characters to each page."
  ]
}`;
}

/**
 * Builds the user message containing failing audit details for all categories.
 *
 * @param {Object} negativeAudits  - Map of { categoryId: Array<{id, title, description, displayValue}> }
 * @returns {string}
 */
export function buildPerfSuggestionsUserMessage(negativeAudits) {
  const CATEGORY_LABELS = {
    performance:      'Performance',
    accessibility:    'Accessibility',
    'best-practices': 'Best Practices',
    seo:              'SEO',
  };

  const sections = Object.entries(negativeAudits)
    .filter(([, audits]) => audits.length > 0)
    .map(([cat, audits]) => {
      const label = CATEGORY_LABELS[cat] || cat;
      const items = audits
        .map(a => {
          const val   = a.displayValue ? ` [${a.displayValue}]` : '';
          const desc  = a.description  ? ` — ${a.description.slice(0, 100)}` : '';
          return `  • ${a.title}${val}${desc}`;
        })
        .join('\n');
      return `### ${label}\n${items}`;
    })
    .join('\n\n');

  return `Below are the failing Lighthouse audits. Provide fix suggestions in the JSON format described in your instructions.\n\n${sections}`;
}
