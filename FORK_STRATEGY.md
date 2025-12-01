# Playwright MCP Fork Strategy

## Problem Analysis

The Playwright MCP server has built-in verification tools (`browser_verify_*`) but they're gated behind `capability: "testing"` which **cannot be enabled** via CLI flags.

### Source Code Location
- **Repository**: https://github.com/microsoft/playwright
- **MCP Source**: `packages/playwright/src/mcp/browser/tools/verify.ts`
- **Tool Registration**: `packages/playwright/src/mcp/browser/tools.ts`
- **Capability Filtering**: Line 62-64 in `tools.ts`

```typescript
export function filteredTools(config: FullConfig) {
  return browserTools.filter(tool => 
    tool.capability.startsWith('core') || 
    config.capabilities?.includes(tool.capability)
  );
}
```

## Solution: Fork & Modify

### Step 1: Fork the Repository

```bash
# Clone your fork
git clone https://github.com/<YOUR_USERNAME>/playwright.git
cd playwright

# Add upstream remote
git remote add upstream https://github.com/microsoft/playwright.git

# Create a feature branch
git checkout -b mcp-enable-testing-tools
```

### Step 2: Make the Critical Changes

#### Change 1: Update verify.ts

**File**: `packages/playwright/src/mcp/browser/tools/verify.ts`

```typescript
// Change ALL capability: "testing" to capability: "core"

const verifyElement = defineTabTool({
  capability: 'core', // ← Changed from 'testing'
  schema: {
    name: 'browser_verify_element_visible',
    // ... rest
  }
});

const verifyText = defineTabTool({
  capability: 'core', // ← Changed from 'testing'
  // ...
});

const verifyList = defineTabTool({
  capability: 'core', // ← Changed from 'testing'
  // ...
});

const verifyValue = defineTabTool({
  capability: 'core', // ← Changed from 'testing'
  // ...
});
```

#### Change 2: Add browser_assert Tool

**File**: `packages/playwright/src/mcp/browser/tools/verify.ts`

Add at the end before the export:

```typescript
const browserAssert = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_assert',
    title: 'Assert JavaScript expression',
    description: 'Assert that a JavaScript expression evaluates to true. Fails if expression is false.',
    inputSchema: z.object({
      expression: z.string().describe('JavaScript expression that should evaluate to true'),
      message: z.string().optional().describe('Optional error message if assertion fails'),
    }),
    type: 'assertion',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();
    await tab.waitForCompletion(async () => {
      const result = await tab.page.evaluate(params.expression);
      if (result !== true) {
        const errorMsg = params.message || `Assertion failed: ${params.expression} evaluated to ${JSON.stringify(result)}`;
        response.addError(errorMsg);
        return;
      }
      response.addCode(`await expect(page.evaluate(${javascript.quote(params.expression)})).resolves.toBe(true);`);
      response.addResult('Assertion passed');
    });
  },
});

export default [
  verifyElement,
  verifyText,
  verifyList,
  verifyValue,
  browserAssert, // ← Added
];
```

### Step 3: Build the Modified Version

```bash
# Install dependencies
npm install

# Build Playwright
npm run build

# This creates compiled files in packages/playwright/lib/
```

### Step 4: Use Your Fork in Your Project

**Option A: Link Locally (Development)**

```bash
cd playwright/packages/playwright
npm link

cd /home/dhruv/Desktop/Playwright-MCP-testing
npm link playwright
```

**Option B: Install from GitHub (Production)**

```json
// package.json
{
  "dependencies": {
    "playwright": "git+https://github.com/<YOUR_USERNAME>/playwright.git#mcp-enable-testing-tools",
    "@playwright/mcp": "git+https://github.com/<YOUR_USERNAME>/playwright.git#mcp-enable-testing-tools"
  }
}
```

### Step 5: Update Your Framework

**File**: `direct_mcp_stateless.js`

```javascript
const transport = new StdioClientTransport({
  command: './node_modules/@playwright/mcp/cli.js',
  args: [
    '--ignore-https-errors',
    '--output-dir', config.reporting.screenshotsDir,
    '--viewport-size', `${config.browser.viewport.width}x${config.browser.viewport.height}`
    // NO --caps=testing needed! Verification tools are now 'core'
  ],
  // ...
});
```

## Available Assertion Tools After Fork

After this fork, you'll have these assertion tools always available:

1. **`browser_verify_element_visible`** - Check element by role & name
2. **`browser_verify_text_visible`** - Check if text is visible
3. **`browser_verify_list_visible`** - Verify list items
4. **`browser_verify_value`** - Check input/checkbox values
5. **`browser_assert`** (NEW) - Generic JavaScript expression assertions

## Maintenance Strategy

### Keep Your Fork Updated

```bash
# Fetch upstream changes
git fetch upstream

# Merge upstream main into your branch
git checkout mcp-enable-testing-tools
git merge upstream/main

# Resolve conflicts (usually in verify.ts)
# The conflict will be your capability: 'core' vs upstream's capability: 'testing'
# Keep your changes: capability: 'core'

# Rebuild
npm run build

# Push to your fork
git push origin mcp-enable-testing-tools
```

### Alternative: Use patch-package

If you don't want to maintain a fork, use `patch-package`:

```bash
# Install patch-package
npm install patch-package --save-dev

# Make your changes to node_modules/playwright/lib/mcp/browser/tools/verify.js
# (Change capability: "testing" to capability: "core")

# Create a patch
npx patch-package playwright

# This creates patches/playwright+<version>.patch
# Add to package.json:
```

```json
{
  "scripts": {
    "postinstall": "patch-package"
  }
}
```

Now the patch applies automatically after `npm install`!

## Testing Your Fork

```bash
# Test that verification tools are discovered
node -e "
const { filteredTools } = require('./node_modules/playwright/lib/mcp/browser/tools.js');
const config = { capabilities: [] };
const tools = filteredTools(config);
console.log('Verification tools:');
tools.filter(t => t.schema.name.includes('verify') || t.schema.name === 'browser_assert')
  .forEach(t => console.log('  -', t.schema.name, '(capability:', t.capability + ')'));
"
```

Expected output:
```
Verification tools:
  - browser_verify_element_visible (capability: core)
  - browser_verify_text_visible (capability: core)
  - browser_verify_list_visible (capability: core)
  - browser_verify_value (capability: core)
  - browser_assert (capability: core)
```

## Benefits of This Approach

✅ **Proper Solution**: Uses actual Playwright verification tools, not workarounds  
✅ **No Virtual Tools**: All tools are native to Playwright MCP  
✅ **Error Handling**: Tools properly return `isError: true` when assertions fail  
✅ **Code Generation**: Tools generate proper Playwright test code  
✅ **Maintainable**: Can sync with upstream Playwright updates  
✅ **Future-Proof**: If Microsoft enables testing capability, easy to revert  

## Implementation Checklist

- [ ] Fork microsoft/playwright repository
- [ ] Create feature branch `mcp-enable-testing-tools`
- [ ] Modify `packages/playwright/src/mcp/browser/tools/verify.ts`
  - [ ] Change all `capability: 'testing'` to `capability: 'core'`
  - [ ] Add `browser_assert` tool
- [ ] Build the project (`npm run build`)
- [ ] Test locally with `npm link`
- [ ] Update `direct_mcp_stateless.js` to use local MCP server
- [ ] Run tests to verify assertions work
- [ ] Document the fork for team members
- [ ] Set up upstream sync strategy

## Next Steps

1. **Create the fork** and make changes
2. **Test locally** to verify everything works
3. **Update your project** to use the fork
4. **Run your test suite** to confirm assertions fail properly
5. **Document** the changes for your team
