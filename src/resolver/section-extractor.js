/**
 * Section Extractor
 * ─────────────────
 * Given a full accessibility snapshot and a test step description,
 * extracts only the relevant section subtree so the LLM gets focused
 * context instead of the entire page tree.
 *
 * Strategy:
 * 1. Parse the full snapshot into nodes
 * 2. Extract keywords from the test step
 * 3. Find the best-matching section/landmark that contains the target element
 * 4. Serialize that subtree back to snapshot text format
 */

import { SnapshotParser } from './snapshot-parser.js';

/** Roles that define logical page sections (landmarks) */
const SECTION_ROLES = new Set([
  'navigation', 'main', 'complementary', 'banner', 'contentinfo',
  'region', 'form', 'dialog', 'alertdialog', 'tabpanel', 'tablist',
  'toolbar', 'menu', 'menubar', 'group', 'list', 'article', 'section',
  'aside', 'footer', 'header', 'div', 'ul'
]);

/** Minimum depth for a node to be considered a section root */
const MIN_SECTION_DEPTH = 1;

/** Maximum depth for a node to be considered a section root (avoid too-nested) */
const MAX_SECTION_DEPTH = 4;

export class SectionExtractor {
  constructor() {
    this.parser = new SnapshotParser();
  }

  /**
   * Extract the most relevant section from a snapshot based on a test step.
   *
   * @param {string} fullSnapshot - Raw snapshot text from browser_snapshot
   * @param {string} stepDescription - The test step text (e.g. "Click the BUSINESSES filter")
   * @param {Object} [opts]
   * @param {number} [opts.maxLines=150] - Maximum lines to return
   * @param {boolean} [opts.includeParentContext=true] - Include parent chain for context
   * @returns {{ section: string, sectionRef: string|null, confidence: number }}
   */
  extract(fullSnapshot, stepDescription, opts = {}) {
    const { maxLines = 150, includeParentContext = true } = opts;

    if (!fullSnapshot || !stepDescription) {
      return { section: fullSnapshot || '', sectionRef: null, confidence: 0 };
    }

    const nodes = this.parser.parse(fullSnapshot);
    if (nodes.length === 0) {
      return { section: fullSnapshot, sectionRef: null, confidence: 0 };
    }

    // 1. Extract keywords from the test step
    const keywords = this._extractKeywords(stepDescription);

    // 2. Find target element candidates (nodes matching keywords)
    const targetNodes = this._findTargetNodes(nodes, keywords);

    if (targetNodes.length === 0) {
      // No match found — return full snapshot
      return { section: fullSnapshot, sectionRef: null, confidence: 0 };
    }

    // 3. Find the best section ancestor that contains the target(s)
    const sectionNode = this._findBestSection(nodes, targetNodes);

    if (!sectionNode) {
      // No good section boundary — return full snapshot
      return { section: fullSnapshot, sectionRef: null, confidence: 0 };
    }

    // 4. Serialize the section subtree back to text
    const sectionText = this._serializeSubtree(nodes, sectionNode, includeParentContext, maxLines);

    return {
      section: sectionText,
      sectionRef: sectionNode.ref,
      confidence: targetNodes.length === 1 ? 1.0 : 0.7
    };
  }

  /**
   * Extract meaningful keywords from a test step description.
   * Strips common verbs/articles and returns content words.
   */
  _extractKeywords(description) {
    // Remove step numbering and common prefixes
    let cleaned = description
      .replace(/^[-•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/^(click|tap|type|enter|fill|select|choose|scroll|navigate|press|verify|check|ensure|open|close|toggle|submit|reset|hover|drag)\s+(on\s+|the\s+|a\s+|an\s+|to\s+|into\s+|in\s+)?/i, '')
      .trim();

    // Remove quoted text markers but keep the text
    cleaned = cleaned.replace(/["'()]/g, ' ');

    // Stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
      'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
      'with', 'from', 'by', 'as', 'into', 'should', 'must', 'will', 'can',
      'click', 'type', 'enter', 'select', 'choose', 'scroll', 'navigate',
      'press', 'verify', 'check', 'ensure', 'open', 'close', 'wait', 'page',
      'button', 'link', 'tab', 'menu', 'option', 'dropdown', 'field', 'input',
      'icon', 'bar', 'section', 'filter'
    ]);

    const words = cleaned
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w));

    // Also keep the full cleaned phrase for exact matching
    const phrases = [];
    // Extract quoted strings from original description
    const quoteMatches = description.match(/"([^"]+)"/g);
    if (quoteMatches) {
      quoteMatches.forEach(q => phrases.push(q.replace(/"/g, '').toLowerCase()));
    }

    return { words, phrases };
  }

  /**
   * Find nodes in the tree that match the keywords from the test step.
   */
  _findTargetNodes(nodes, keywords) {
    const { words, phrases } = keywords;
    const scored = [];

    for (const node of nodes) {
      if (!node.ref) continue;

      let score = 0;
      const nodeText = (node.text || '').toLowerCase();
      const nodeRole = (node.role || '').toLowerCase();

      // Exact phrase match in node text (strongest signal)
      for (const phrase of phrases) {
        if (nodeText.includes(phrase)) score += 20;
      }

      // Word matches in node text
      for (const word of words) {
        if (nodeText.includes(word)) score += 5;
      }

      // Word matches in subtree text (weaker signal)
      const subtree = (node.subtreeText || '').toLowerCase();
      for (const phrase of phrases) {
        if (subtree.includes(phrase) && !nodeText.includes(phrase)) score += 3;
      }

      if (score > 0) {
        scored.push({ node, score });
      }
    }

    // Sort by score and return top matches
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(s => s.node);
  }

  /**
   * Walk up from target nodes to find the best section/landmark ancestor.
   * Prefers the tightest section that still contains all targets.
   */
  _findBestSection(nodes, targetNodes) {
    // Collect all ancestor sections for each target
    const sectionCandidates = new Map(); // sectionIndex → count of targets it contains

    for (const target of targetNodes) {
      let current = target;
      while (current.parentIndex >= 0) {
        current = nodes[current.parentIndex];

        const isSection = SECTION_ROLES.has(current.role) &&
          current.depth >= MIN_SECTION_DEPTH &&
          current.depth <= MAX_SECTION_DEPTH;

        if (isSection) {
          const count = sectionCandidates.get(current.index) || 0;
          sectionCandidates.set(current.index, count + 1);
        }
      }
    }

    if (sectionCandidates.size === 0) {
      // No landmark sections found — try the parent of the first target
      const firstTarget = targetNodes[0];
      if (firstTarget.parentIndex >= 0) {
        return nodes[firstTarget.parentIndex];
      }
      return null;
    }

    // Pick the deepest (most specific) section that contains at least one target
    // If multiple sections contain targets, prefer the deepest one
    let bestSection = null;
    let bestDepth = -1;

    for (const [idx, count] of sectionCandidates) {
      const section = nodes[idx];
      // Prefer deeper sections (more specific), but also prefer ones
      // that contain more targets
      const effectiveDepth = section.depth * 10 + count;
      if (effectiveDepth > bestDepth) {
        bestDepth = effectiveDepth;
        bestSection = section;
      }
    }

    // Verify the section isn't too large (more than half the page)
    if (bestSection) {
      const subtreeSize = this._countSubtreeNodes(nodes, bestSection);
      if (subtreeSize > nodes.length * 0.7) {
        // Section too big — try a deeper child section
        const childSections = bestSection.children
          .map(i => nodes[i])
          .filter(n => SECTION_ROLES.has(n.role));

        // Find child section containing a target
        for (const child of childSections) {
          const childSubtreeRefs = this._getSubtreeRefs(nodes, child);
          if (targetNodes.some(t => childSubtreeRefs.has(t.ref))) {
            return child;
          }
        }
      }
    }

    return bestSection;
  }

  /**
   * Serialize a subtree back into snapshot text format.
   */
  _serializeSubtree(nodes, sectionNode, includeParentContext, maxLines) {
    const lines = [];

    // Optionally include parent chain for context
    if (includeParentContext) {
      const ancestors = [];
      let cur = sectionNode;
      while (cur.parentIndex >= 0) {
        cur = nodes[cur.parentIndex];
        ancestors.unshift(cur);
      }
      // Only include immediate parents (not full chain) to save tokens
      const relevantAncestors = ancestors.slice(-2);
      for (const anc of relevantAncestors) {
        lines.push(anc.rawLine);
      }
    }

    // Serialize the section and all its descendants
    const queue = [sectionNode.index];
    while (queue.length > 0 && lines.length < maxLines) {
      const idx = queue.shift();
      const node = nodes[idx];
      if (!node) continue;
      lines.push(node.rawLine);
      // Add children in order
      for (const childIdx of node.children) {
        queue.push(childIdx);
      }
    }

    if (lines.length >= maxLines) {
      lines.push('  ... (truncated)');
    }

    return lines.join('\n');
  }

  /**
   * Count nodes in a subtree.
   */
  _countSubtreeNodes(nodes, root) {
    let count = 0;
    const queue = [root.index];
    while (queue.length > 0) {
      const idx = queue.shift();
      const node = nodes[idx];
      if (!node) continue;
      count++;
      queue.push(...node.children);
    }
    return count;
  }

  /**
   * Get all refs in a subtree.
   */
  _getSubtreeRefs(nodes, root) {
    const refs = new Set();
    const queue = [root.index];
    while (queue.length > 0) {
      const idx = queue.shift();
      const node = nodes[idx];
      if (!node) continue;
      if (node.ref) refs.add(node.ref);
      queue.push(...node.children);
    }
    return refs;
  }
}
