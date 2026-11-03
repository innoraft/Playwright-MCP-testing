// Shared stdio-based Playwright MCP server wrapper, reused by every OpenAI-Agents-SDK runner.
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class MCPServerSdkStdio {
  cacheToolsList = true;
  toolFilter;
  toolMetaResolver;
  errorFunction;
  allowBrowserClose = true;
  _cachedTools;
  _client;
  _transport;

  constructor(options = {}) {
    this._name = options.name ?? "playwright";
    this._command = options.command ?? "npx";
    this._args = options.args ?? [];
    this._cwd = options.cwd;
    this._env = options.env;
    this.cacheToolsList = options.cacheToolsList ?? true;
    this.toolFilter = options.toolFilter;
    this.toolMetaResolver = options.toolMetaResolver;
    this.errorFunction = options.errorFunction;
  }

  get name() {
    return this._name;
  }

  async connect() {
    if (this._client) {
      return;
    }

    console.log(`\n[MCP] Connecting to Playwright MCP...`);
    console.log(`[MCP] Command: ${this._command} ${this._args.join(" ")}`);

    this._transport = new StdioClientTransport({
      command: this._command,
      args: this._args,
      cwd: this._cwd,
      stderr: "inherit",
      env: this._env,
    });

    this._client = new MCPClient({
      name: "stateless-mcp-runner",
      version: "2.0.0",
    });

    await this._client.connect(this._transport);
    console.log(`[MCP] Connected successfully\n`);
  }

  async close() {
    if (!this._client) {
      return;
    }

    try {
      await this._client.close();
    } finally {
      this._client = undefined;
      this._transport = undefined;
      this._cachedTools = undefined;
    }
  }

  async listTools() {
    if (this.cacheToolsList && this._cachedTools) {
      return this._cachedTools;
    }

    try {
      console.log(`[MCP] Fetching available tools...`);
      const result = await this._client.listTools();
      const tools = (result?.tools ?? []).map((toolDef) => ({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: {
          type: "object",
          properties: toolDef.inputSchema?.properties ?? {},
          required: toolDef.inputSchema?.required ?? [],
          additionalProperties: toolDef.inputSchema?.additionalProperties ?? true,
        },
      }));

      console.log(`[MCP] Found ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

      if (this.cacheToolsList) {
        this._cachedTools = tools;
      }

      return tools;
    } catch (error) {
      console.error(`[MCP] Failed to list tools:`, error);
      throw error;
    }
  }

  async callTool(toolName, args, meta) {
    try {
      if (toolName === "browser_close" && !this.allowBrowserClose) {
        console.log("[MCP] Skipping browser_close to preserve session across chunks");
        return [
          {
            type: "text",
            text: "### Result\nSkipped browser_close to keep session alive for next chunks.",
          },
        ];
      }

      console.log(`[MCP] Calling tool: ${toolName} with args: ${JSON.stringify(args).slice(0, 200)}`);
      const result = await this._client.callTool({
        name: toolName,
        arguments: args ?? {},
        _meta: meta ?? undefined,
      });

      // Ensure we return the content array in the expected format
      let content = result?.content ?? [];
      if (!Array.isArray(content)) {
        content = [{ type: "text", text: JSON.stringify(content) }];
      }
      console.log(`[MCP] Tool result: ${JSON.stringify(content).slice(0, 200)}`);
      return content;
    } catch (error) {
      console.error(`[MCP] Tool call failed:`, error);
      throw error;
    }
  }

  async listResources(params = {}) {
    return this._client.listResources(params);
  }

  async listResourceTemplates(params = {}) {
    return this._client.listResourceTemplates(params);
  }

  async readResource(uri) {
    return this._client.readResource({ uri });
  }

  async invalidateToolsCache() {
    this._cachedTools = undefined;
  }
}

/**
 * Builds a stdio-transport Playwright MCP server instance.
 * All Playwright/CDP-related settings are passed in explicitly so this helper
 * stays runner-agnostic (no implicit reliance on any one runner's env vars).
 *
 * @param {object} options
 * @param {number} [options.cdpPort] - Local CDP port to attach to (preferred over cdpEndpoint)
 * @param {string} [options.cdpEndpoint] - Explicit CDP endpoint URL, used when cdpPort isn't set
 * @param {string} [options.command] - Executable used to launch the MCP server (default "npx")
 * @param {string} [options.workspaceDir] - cwd for the spawned MCP process
 * @param {string} [options.outputDir] - --output-dir passed to the MCP server
 * @param {string|number} [options.viewportWidth]
 * @param {string|number} [options.viewportHeight]
 * @param {string} [options.browser] - Browser channel (chrome, msedge, etc.)
 * @param {boolean} [options.isolated] - Whether to pass --isolated
 * @param {boolean} [options.headless] - Whether to pass --headless (ignored when cdpPort/cdpEndpoint is set)
 * @returns {MCPServerSdkStdio}
 */
export function buildMcpServer({
  cdpPort,
  cdpEndpoint,
  command = "npx",
  workspaceDir = process.cwd(),
  outputDir = "files/screenshots",
  viewportWidth = "1440",
  viewportHeight = "900",
  browser,
  isolated = true,
  headless = false,
} = {}) {
  const args = ["@playwright/mcp"];
  const finalCdpEndpoint = cdpPort ? `http://127.0.0.1:${cdpPort}` : cdpEndpoint;

  if (finalCdpEndpoint) {
    args.push("--cdp-endpoint", finalCdpEndpoint);
    if (isolated) {
      args.push("--isolated");
    }
  } else {
    // Use a clean Playwright-managed browser profile to avoid native password/change-password prompts.
    if (headless) {
      args.push("--headless");
    }
    if (browser) {
      args.push("--browser", browser);
    }
    if (isolated) {
      args.push("--isolated");
    }
  }

  args.push(
    "--ignore-https-errors",
    "--output-dir",
    outputDir,
    "--viewport-size",
    `${viewportWidth}x${viewportHeight}`,
    "--image-responses",
    "omit"
  );

  return new MCPServerSdkStdio({
    name: "playwright",
    command,
    args,
    cwd: workspaceDir,
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --unhandled-rejections=warn`.trim(),
    },
  });
}
