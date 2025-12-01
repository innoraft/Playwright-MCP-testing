#!/bin/bash

# Quick Start: Fork Playwright and Enable Testing Tools
# This script helps you set up a forked version of Playwright with testing capabilities enabled

set -e

echo "🎭 Playwright MCP Fork Setup"
echo "============================"
echo ""

# Step 1: Fork on GitHub
echo "📝 Step 1: Fork the Repository"
echo "------------------------------"
echo "1. Go to: https://github.com/microsoft/playwright"
echo "2. Click 'Fork' button"
echo "3. Fork to your GitHub account"
echo ""
read -p "Have you forked the repository? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Please fork the repository first, then run this script again."
    exit 1
fi

# Get username
read -p "Enter your GitHub username: " GITHUB_USERNAME
echo ""

# Step 2: Clone
echo "📦 Step 2: Cloning your fork..."
echo "------------------------------"
PLAYWRIGHT_DIR="../playwright-fork"
if [ -d "$PLAYWRIGHT_DIR" ]; then
    echo "⚠️  Directory $PLAYWRIGHT_DIR already exists. Skipping clone."
else
    git clone "https://github.com/$GITHUB_USERNAME/playwright.git" "$PLAYWRIGHT_DIR"
fi
cd "$PLAYWRIGHT_DIR"

# Step 3: Setup upstream
echo ""
echo "🔗 Step 3: Setting up upstream remote..."
echo "---------------------------------------"
git remote add upstream https://github.com/microsoft/playwright.git || echo "Upstream already added"

# Step 4: Create branch
echo ""
echo "🌿 Step 4: Creating feature branch..."
echo "------------------------------------"
git checkout -b mcp-enable-testing-tools || git checkout mcp-enable-testing-tools

# Step 5: Apply changes
echo ""
echo "✏️  Step 5: Modifying verify.ts..."
echo "---------------------------------"

VERIFY_FILE="packages/playwright/src/mcp/browser/tools/verify.ts"

if [ ! -f "$VERIFY_FILE" ]; then
    echo "❌ Error: $VERIFY_FILE not found!"
    echo "Make sure you're in the Playwright repository root."
    exit 1
fi

# Backup original
cp "$VERIFY_FILE" "${VERIFY_FILE}.backup"

# Change capability: 'testing' to capability: 'core'
sed -i "s/capability: 'testing'/capability: 'core'/g" "$VERIFY_FILE"

echo "✅ Changed all 'testing' capabilities to 'core'"

# Step 6: Add browser_assert tool
echo ""
echo "➕ Step 6: Adding browser_assert tool..."
echo "---------------------------------------"

# Find the line with "export default [" and insert before it
cat >> "$VERIFY_FILE" << 'EOF'

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
        const errorMsg = params.message || \`Assertion failed: \${params.expression} evaluated to \${JSON.stringify(result)}\`;
        response.addError(errorMsg);
        return;
      }
      response.addCode(\`await expect(page.evaluate(\${javascript.quote(params.expression)})).resolves.toBe(true);\`);
      response.addResult('Assertion passed');
    });
  },
});
EOF

# Update the export to include browserAssert
# This is a simplified approach - you may need to manually verify
echo ""
echo "⚠️  MANUAL STEP REQUIRED:"
echo "Edit $VERIFY_FILE and add 'browserAssert' to the export default array at the end"
echo "Example:"
echo "  export default ["
echo "    verifyElement,"
echo "    verifyText,"
echo "    verifyList,"
echo "    verifyValue,"
echo "    browserAssert,  // ← Add this line"
echo "  ];"
echo ""
read -p "Press ENTER when you've made this change..." 

# Step 7: Build
echo ""
echo "🔨 Step 7: Installing dependencies and building..."
echo "------------------------------------------------"
npm install
npm run build

echo ""
echo "✅ Build complete!"

# Step 8: Link
echo ""
echo "🔗 Step 8: Linking to your project..."
echo "------------------------------------"
cd packages/playwright
npm link

cd - > /dev/null
cd "$OLDPWD"  # Back to Playwright-MCP-testing
npm link playwright

echo ""
echo "✅ Playwright linked successfully!"

# Step 9: Test
echo ""
echo "🧪 Step 9: Testing the setup..."
echo "-----------------------------"

node -e "
const { filteredTools } = require('./node_modules/playwright/lib/mcp/browser/tools.js');
const config = { capabilities: [] };
const tools = filteredTools(config);
console.log('\\n📋 Available Verification Tools:');
tools.filter(t => t.schema.name.includes('verify') || t.schema.name === 'browser_assert')
  .forEach(t => console.log('  ✓', t.schema.name, '(capability:', t.capability + ')'));
console.log('');
"

echo ""
echo "🎉 Setup Complete!"
echo "================"
echo ""
echo "Next steps:"
echo "1. Update direct_mcp_stateless.js to use local MCP server"
echo "2. Run your tests: node direct_mcp_stateless.js tests/wikipedia-search.test.yml"
echo "3. Verify assertions fail properly when conditions aren't met"
echo ""