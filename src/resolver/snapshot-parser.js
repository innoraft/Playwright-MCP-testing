/**
 * Playwright Snapshot Compressor
 * ================================
 * Parses the raw YAML-like accessibility tree from Playwright MCP
 * and compresses it into a compact, LLM-friendly format.
 *
 * Key design decisions:
 *  - Any element with [cursor=pointer] is treated as interactive,
 *    including generic/div/span/p nodes wired via JS onClick
 *  - Structural landmarks are always kept (nav, main, banner, etc.)
 *  - Headings are always kept (give the LLM page structure)
 *  - Deep generic wrappers with no label/interactivity are collapsed
 *  - Duplicate child text that repeats parent label is stripped
 *  - "(opens in a new tab)" noise is removed from labels
 *  - Output is flat compact string, typically 5-10x smaller than input
 *
 * Usage:
 *   import { compressSnapshot } from './snapshotParser';
 *   const { compact, stats } = compressSnapshot(rawYamlString);
 *
 * CLI:
 *   npx ts-node snapshotParser.js < snapshot.txt
 */

import fs from "fs";
import { fileURLToPath } from "url";

// ─── Role classification ──────────────────────────────────────────────────────

const LANDMARK_ROLES = new Set([
  "banner", "main", "navigation", "complementary",
  "contentinfo", "region", "form", "search",
  "dialog", "alert", "status", "article", "section",
]);

const ALWAYS_INTERACTIVE_ROLES = new Set([
  "link", "button", "textbox", "searchbox", "combobox",
  "checkbox", "radio", "switch", "slider", "spinbutton",
  "tab", "menuitem", "option", "treeitem", "gridcell",
  "columnheader", "rowheader",
]);

const HEADING_ROLES = new Set(["heading"]);

const STRUCTURAL_ROLES = new Set([
  "list", "listitem", "tablist", "tabpanel",
  "table", "row", "group",
]);

const GENERIC_ROLES = new Set([
  "generic", "paragraph", "text", "figure",
  "none", "presentation", "document",
]);

// ─── Short type codes ─────────────────────────────────────────────────────────

const ROLE_SHORT = {
  link: "a", button: "btn", textbox: "input", searchbox: "input",
  combobox: "select", heading: "h", navigation: "nav", banner: "header",
  main: "main", complementary: "aside", contentinfo: "footer",
  dialog: "dialog", list: "ul", listitem: "li", tab: "tab",
  tablist: "tabs", tabpanel: "panel", article: "article", section: "section",
  img: "img", checkbox: "checkbox", radio: "radio", group: "group",
  generic: "div", paragraph: "p", text: "span", document: "doc",
};

// ─── Label cleanup ────────────────────────────────────────────────────────────

const LABEL_NOISE = [
  / \(opens in a new tab\)/gi,
  / \(new tab\)/gi,
  / \(external link\)/gi,
  / \(opens new window\)/gi,
];

function cleanLabel(label) {
  let out = label;
  for (const p of LABEL_NOISE) out = out.replace(p, "");
  return out.trim();
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parseSnapshot(raw) {
  const lines = raw.split("\n");
  const root = [];
  const stack = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Property line e.g. "  - /url: /some/path"
    const propMatch = line.match(/^(\s*)- (\/[\w-]+): (.*)$/);
    if (propMatch) {
      const [, , key, value] = propMatch;
      const parent = stack[stack.length - 1];
      if (parent) {
        const v = value.trim().replace(/^"(.*)"$/, "$1");
        if (key === "/url")         parent.node.url = v;
        if (key === "/placeholder") parent.node.placeholder = v;
      }
      continue;
    }

    // Node line
    const nodeMatch = line.match(/^(\s*)- (.+)$/);
    if (!nodeMatch) continue;

    const [, indentStr, rest] = nodeMatch;
    const indent = indentStr.length;
    const node = parseNodeLine(rest);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ node, indent });
  }

  return root;
}

function parseNodeLine(rest) {
  const node = { role: "generic", clickable: false, children: [] };

  if (rest.includes("[cursor=pointer]")) {
    node.clickable = true;
    rest = rest.replace(/\[cursor=pointer\]/g, "").trim();
  }

  const refMatch = rest.match(/\[ref=([\w]+)\]/);
  if (refMatch) {
    node.ref = refMatch[1];
    rest = rest.replace(refMatch[0], "").trim();
  }

  if (rest.includes("[selected]")) {
    node.selected = true;
    rest = rest.replace(/\[selected\]/g, "").trim();
  }

  const levelMatch = rest.match(/\[level=(\d+)\]/);
  if (levelMatch) {
    node.level = parseInt(levelMatch[1]);
    rest = rest.replace(levelMatch[0], "").trim();
  }

  // Strip trailing colon
  rest = rest.replace(/:$/, "").trim();

  // role "label"
  const roleLabelMatch = rest.match(/^([\w-]+)\s+"([^"]*)"(.*)$/);
  if (roleLabelMatch) {
    node.role = roleLabelMatch[1].toLowerCase();
    node.label = cleanLabel(roleLabelMatch[2]);
  } else {
    const spaceIdx = rest.search(/\s/);
    if (spaceIdx === -1) {
      node.role = rest.toLowerCase();
    } else {
      node.role = rest.slice(0, spaceIdx).toLowerCase();
      const trailing = rest.slice(spaceIdx).trim().replace(/^:\s*/, "");
      if (trailing && !trailing.startsWith("[")) {
        node.label = cleanLabel(trailing);
      }
    }
  }

  if (ALWAYS_INTERACTIVE_ROLES.has(node.role)) node.clickable = true;

  return node;
}

// ─── Tree pruning ─────────────────────────────────────────────────────────────

export function pruneTree(nodes, opts = {}) {
  return nodes.map(n => pruneNode(n, opts)).filter(n => n !== null);
}

function pruneNode(node, opts) {
  // Prune children first
  let children = node.children
    .map(c => pruneNode(c, opts))
    .filter(c => c !== null);

  // Remove children whose label exactly echoes parent label
  if (node.label) {
    children = children.filter(c => !c.label || normalize(c.label) !== normalize(node.label));
  }

  // Remove text-only children from headings when they sum to the heading label
  if (HEADING_ROLES.has(node.role) && node.label) {
    const textChildren = children.filter(c => c.role === "text" && c.label && !c.clickable);
    const joined = textChildren.map(c => c.label).join(" ");
    if (normalize(joined) === normalize(node.label)) {
      children = children.filter(c => !(c.role === "text" && !c.clickable));
    }
  }

  const updated = { ...node, children };

  // Viewport filter
  if (opts.visibleRefs && node.ref && !opts.visibleRefs.has(node.ref) && children.length === 0) {
    return null;
  }

  if (LANDMARK_ROLES.has(node.role))          return updated;
  if (HEADING_ROLES.has(node.role))           return updated;
  if (node.clickable)                          return updated;

  if (node.role === "img") {
    if (opts.keepImages && node.label && node.label.length > 3) return updated;
    return children.length > 0 ? { ...updated, role: "generic" } : null;
  }

  if (STRUCTURAL_ROLES.has(node.role)) {
    if (children.length === 0) return null;
    if (children.length === 1 && !node.label && !node.ref) return children[0];
    return updated;
  }

  if (GENERIC_ROLES.has(node.role)) {
    if (children.length === 0 && !node.label) return null;
    if (!node.label && !node.ref && !node.clickable) {
      if (children.length === 1) return children[0];
      if (children.length > 1)  return updated;
      return null;
    }
    return updated;
  }

  if (children.length > 0 || node.label) return updated;
  return null;
}

// ─── Compact serializer ───────────────────────────────────────────────────────

export function serializeCompact(nodes, depth = 0, opts = {}) {
  if (opts.maxDepth !== undefined && depth > opts.maxDepth) return "";
  const indent = "  ".repeat(depth);
  const lines = [];

  for (const node of nodes) {
    const typeCode    = HEADING_ROLES.has(node.role) && node.level
                          ? `h${node.level}` : (ROLE_SHORT[node.role] ?? node.role);
    const refPart     = node.ref      ? `[${node.ref}]`       : "";
    const selPart     = node.selected ? "*"                    : "";
    // ▶ signals to the LLM: this is a JS-wired clickable (div/span/p)
    const jsPart      = node.clickable && GENERIC_ROLES.has(node.role) ? "▶" : "";
    const labelPart   = node.label       ? ` "${node.label}"`     : "";
    const urlPart     = node.url         ? ` ${node.url}`         : "";
    const phPart      = node.placeholder ? ` ?"${node.placeholder}"` : "";

    const line = `${indent}${typeCode}${refPart}${selPart}${jsPart}${labelPart}${urlPart}${phPart}`;

    // Transparent wrapper — no ref, no label, no url: skip line, recurse at same depth
    if (!node.ref && !node.label && !node.url) {
      if (node.children.length > 0) {
        lines.push(serializeCompact(node.children, depth, opts));
      }
      continue;
    }

    lines.push(line);
    if (node.children.length > 0) {
      lines.push(serializeCompact(node.children, depth + 1, opts));
    }
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Full pipeline: raw Playwright snapshot → compact LLM-ready string.
 *
 * @param rawSnapshot  YAML-like string from Playwright MCP tool result
 * @param opts         Compression options
 */
export function compressSnapshot(rawSnapshot, opts = {}) {
  const cleaned = rawSnapshot
    .replace(/^```ya?ml\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const tree   = parseSnapshot(cleaned);
  const pruned = pruneTree(tree, opts);
  const compact = serializeCompact(pruned, 0, opts);

  return {
    compact,
    tree: pruned,
    stats: {
      rawChars:     cleaned.length,
      compactChars: compact.length,
      reductionPct: ((1 - compact.length / cleaned.length) * 100).toFixed(1) + "%",
    },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raw = fs.readFileSync("/dev/stdin", "utf-8");
  const { compact, stats } = compressSnapshot(raw, { keepImages: false });
  console.log("=== COMPRESSED SNAPSHOT ===\n");
  console.log(compact);
  console.log("\n=== STATS ===");
  console.log(`Raw:     ${stats.rawChars.toLocaleString()} chars`);
  console.log(`Compact: ${stats.compactChars.toLocaleString()} chars`);
  console.log(`Saved:   ${stats.reductionPct}`);
}
