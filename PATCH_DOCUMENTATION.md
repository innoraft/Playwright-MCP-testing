# Playwright MCP Verification Tools Patch

## Overview

This patch enables native Playwright verification/assertion tools in the MCP (Model Context Protocol) by changing their capability from `"testing"` to `"core"`. This allows the tools to be accessible without requiring special capability flags.

## Source of Truth

**All logic in this patch comes directly from the official Microsoft Playwright repository:**
- Repository: https://github.com/microsoft/playwright
- Source File: `packages/playwright/src/mcp/browser/tools/verify.ts`
- Response Class: `packages/playwright/src/mcp/browser/response.ts`

## What Changed

### 1. Changed Capabilities (4 tools)

Changed from `capability: "testing"` to `capability: "core"` for:

1. **`browser_verify_element_visible`** - Verify element by role and accessible name
2. **`browser_verify_text_visible`** - Verify text is visible on page  
3. **`browser_verify_list_visible`** - Verify list items are visible
4. **`browser_verify_value`** - Verify input/checkbox/radio values

### 2. Added New Tool

**`browser_assert`** - Generic JavaScript assertion tool
- Evaluates JavaScript expressions
- Returns `isError: true` when assertion fails
- Uses official Playwright `response.addError()` method

## How Assertions Work (From Official Playwright)

The assertion mechanism is implemented in Playwright's Response class:

```typescript
// From: packages/playwright/src/mcp/browser/response.ts

addError(error: string) {
  this._result.push(error);
  this._isError = true;  // ← Sets error flag
}

serialize() {
  // ...
  return { content, isError: this._isError };  // ← Returns flag
}
```

### Tool Handler Pattern (From Official Source)

```typescript
// From: packages/playwright/src/mcp/browser/tools/verify.ts

handle: async (tab, params, response) => {
  const locator = tab.page.getByText(params.text).filter({ visible: true });
  if (await locator.count() === 0) {
    response.addError("Text not found");  // ← Calls addError
    return;  // ← Exits early
  }
  response.addCode(`await expect(...).toBeVisible();`);
  response.addResult("Done");
}
```

## Error Handling Flow

1. **Assertion Check**: Tool checks condition (e.g., element exists)
2. **Failure Path**: If condition fails, calls `response.addError(message)`
3. **Internal Flag**: Response object sets `this._isError = true`
4. **Serialization**: Response returns `{ content: [...], isError: true }`
5. **MCP Protocol**: Client receives `isError: true` flag in result
6. **Test Runner**: Checks `result.isError` and throws error to fail test

## Why This Patch Is Necessary

Playwright's capability system filters tools at runtime:

```typescript
// From: packages/playwright/src/mcp/browser/tools.ts
export function filteredTools(tools: Tool[], config: FullConfig): Tool[] {
  return tools.filter(tool => 
    tool.capability.startsWith('core') || 
    config.capabilities?.includes(tool.capability)
  );
}
```

Without this patch:
- Tools with `capability: "testing"` are filtered out
- No way to enable "testing" capability via CLI
- Only "vision" and "pdf" capabilities are configurable

With this patch:
- All verification tools have `capability: "core"`
- Tools are included in default tool list
- Native assertion capabilities available immediately

## Test Coverage (From Microsoft)

Microsoft has extensive test coverage for these tools:

```typescript
// From: tests/mcp/verify.spec.ts

test('browser_verify_text_visible (not found)', async ({ client, server }) => {
  // ...
  expect(await client.callTool({
    name: 'browser_verify_text_visible',
    arguments: { text: 'Goodbye world' },
  })).toHaveResponse({
    isError: true,  // ← Confirms isError flag is set
    result: 'Text not found',
  });
});
```

## Verification Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Verify Patch Applied**
   ```bash
   node -e "const tools = require('./node_modules/playwright/lib/mcp/browser/tools/verify.js').default; console.log(tools.map(t => ({ name: t.schema.name, capability: t.capability })))"
   ```

3. **Expected Output**
   ```json
   [
     { "name": "browser_verify_element_visible", "capability": "core" },
     { "name": "browser_verify_text_visible", "capability": "core" },
     { "name": "browser_verify_list_visible", "capability": "core" },
     { "name": "browser_verify_value", "capability": "core" },
     { "name": "browser_assert", "capability": "core" }
   ]
   ```

## Running Tests

```bash
# Passing test
node direct_mcp_stateless.js tests/wikipedia-search.test.yml

# Failing test (verifies error detection)
node direct_mcp_stateless.js tests/wikipedia-fail.test.yml

# Comprehensive test
node direct_mcp_stateless.js tests/example-comprehensive.test.yml
```

## Maintenance

### When Playwright Updates

If you upgrade Playwright and the patch fails:

1. **Recreate the patch:**
   ```bash
   # Edit node_modules/playwright/lib/mcp/browser/tools/verify.js
   # Make the same changes (capability: "testing" → "core")
   npx patch-package playwright
   ```

2. **Verify changes against source:**
   - Check https://github.com/microsoft/playwright/blob/main/packages/playwright/src/mcp/browser/tools/verify.ts
   - Ensure `response.addError()` pattern is still the same
   - Confirm capability filtering logic hasn't changed

### Contributing Back

To contribute this change back to Playwright:

1. Fork https://github.com/microsoft/playwright
2. Modify `packages/playwright/src/mcp/browser/tools/verify.ts`
3. Change all `capability: "testing"` to `capability: "core"`
4. Submit Pull Request with justification

## References

- **Official Playwright Repo**: https://github.com/microsoft/playwright
- **MCP Verification Tools**: packages/playwright/src/mcp/browser/tools/verify.ts
- **Response Class**: packages/playwright/src/mcp/browser/response.ts
- **Tool Filtering**: packages/playwright/src/mcp/browser/tools.ts
- **Test Suite**: tests/mcp/verify.spec.ts

## License

This patch modifies code from the Microsoft Playwright project, which is licensed under the Apache License 2.0.

**Original Copyright Notice:**
```
Copyright (c) Microsoft Corporation.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
```

## Acknowledgments

All verification tool logic, error handling patterns, and assertion mechanisms are from the official Microsoft Playwright project. This patch simply changes the capability designation to make these tools accessible in standard MCP usage.
