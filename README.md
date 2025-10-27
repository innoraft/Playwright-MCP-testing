# Playwright MCP Testing Framework

A powerful, AI-driven test automation framework that combines the Model Context Protocol (MCP) with Playwright to enable natural language test creation and execution.

## 🚀 Features

- **Natural Language Tests**: Write tests in plain English instead of code
- **AI-Powered Translation**: Uses OpenAI's GPT models to convert natural language to browser actions
- **Comprehensive Error Reporting**: Detailed failure analysis showing expected vs actual results
- **MCP Integration**: Leverages Model Context Protocol for seamless browser automation
- **Multi-Website Support**: Generalized framework that works with any website
- **Smart Element Detection**: Automatic element finding using AI-powered matching
- **Rich Test Reports**: HTML and text reports with screenshots and detailed analytics
- **Flexible Evaluation**: Intelligent test result evaluation with context-aware failure detection

## 📋 Prerequisites

- Node.js (v16 or higher)
- OpenAI API key
- Modern web browser (Chrome/Firefox/Safari)

## 🛠️ Installation

1. Clone the repository:
```bash
git clone https://github.com/innoraft/Playwright-MCP-testing.git
cd Playwright-MCP-testing
```

2. Install dependencies:
```bash
npm install
```

3. Set up your OpenAI API key:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

## 📝 Usage

### Basic Test Creation

Create a test file (e.g., `tests/my-test.test.txt`) with natural language instructions:

```
Navigate to https://example.com
Wait for the page to load
Click on the "Login" button
Enter "testuser" in the username field
Enter "password123" in the password field
Click the "Submit" button
Verify that login was successful by checking for logout link
Take a screenshot of the dashboard
```

### Running Tests

Execute your test with:

```bash
node mcp_llm_runner.js tests/my-test.test.txt
```

### Test Report

After execution, you'll get:
- Detailed console output with step-by-step execution
- HTML report with screenshots and analytics
- Test reports saved in `test-reports/` directory
- Screenshots saved in `test-screenshots/` directory

## 🧪 Example Tests

The framework includes several example tests:

- **Simple Navigation**: Basic website navigation and interaction
- **Drupal Login**: CMS login workflow testing
- **API Demo Navigation**: REST API interface testing
- **Content Creation**: Dynamic content management testing
- **Form Submission**: Complex form interaction testing
- **Responsive Design**: Multi-device testing scenarios

## 📊 Test Reports

The framework generates comprehensive reports including:

### Summary Statistics
- Total actions executed
- Pass/fail rates
- Execution duration
- Success percentages

### Detailed Action Analysis
- Individual step outcomes
- Execution times
- Error details with expected vs actual results
- Failure reasons and debugging information

### Visual Documentation
- Full-page screenshots at key steps
- Element highlighting
- Before/after comparisons

## 🔧 Configuration

### MCP Configuration (`playwright-mcp.config.json`)

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-playwright"],
      "env": {
        "PLAYWRIGHT_BROWSER": "chromium"
      }
    }
  }
}
```

### Framework Configuration

Key configuration options in `mcp_llm_runner.js`:

- **Browser Settings**: Headless mode, viewport size, timeout settings
- **AI Model**: OpenAI model selection and parameters
- **Reporting**: Output formats and detail levels
- **Screenshots**: Automatic screenshot triggers and quality settings

## 🎯 Advanced Features

### Smart Element Detection

The framework uses AI to intelligently match element descriptions to actual page elements:

```
Click on the "Sign In" button
Enter text in the search box
Select "Option 2" from the dropdown
```

### Flexible Evaluation Logic

Tests can include complex verification logic:

```
Verify the page loaded successfully by checking:
- Page title contains "Dashboard"
- User menu is visible
- No error messages are present
- Loading indicators are gone
```

### Error Recovery

Built-in error handling and recovery mechanisms:
- Automatic retries for transient failures
- Smart waiting for dynamic content
- Fallback element selection strategies

## 🚀 Best Practices

### Writing Effective Tests

1. **Be Specific**: Use clear, unambiguous descriptions
   ```
   ✅ Click the "Submit Order" button in the checkout form
   ❌ Click the button
   ```

2. **Include Verification**: Always verify expected outcomes
   ```
   ✅ Verify that the order confirmation page displays with order number
   ❌ Click submit (without verification)
   ```

3. **Use Wait Strategies**: Allow time for dynamic content
   ```
   ✅ Wait for the loading spinner to disappear
   ✅ Wait 3 seconds for animations to complete
   ```

### Test Organization

- Group related tests in logical directories
- Use descriptive test file names
- Include setup and teardown steps
- Document complex test scenarios

## 🛡️ Error Handling

The framework provides detailed error reporting:

### Common Error Types
- **Element Not Found**: When specified elements can't be located
- **Timeout Errors**: When operations exceed time limits
- **Validation Failures**: When test assertions fail
- **Network Issues**: When pages fail to load

### Error Report Example
```
❌ Action 5: browser_click
   Status: FAILED
   Expected: Button element with text "Submit"
   Actual: Element not found
   Reason: The specified button could not be located on the current page
   Duration: 2043ms
```

## 🔍 Debugging

### Debug Mode

Enable verbose logging:
```bash
DEBUG=true node mcp_llm_runner.js tests/my-test.test.txt
```

### Screenshot Analysis

Automatic screenshots are captured at:
- Page navigation events
- Before/after important actions
- When tests fail
- At test completion

### Log Analysis

Check detailed logs in:
- Console output for real-time feedback
- Test reports for historical analysis
- Screenshot files for visual debugging

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

### Development Setup

```bash
# Install development dependencies
npm install --dev

# Run tests
npm test

# Run linting
npm run lint
```

## 📚 API Reference

### Core Functions

- `runMcpActions(actions)`: Execute a sequence of browser actions
- `extractEvaluationResult(result)`: Parse test evaluation outcomes
- `generateReport(report)`: Create comprehensive test reports
- `findElementRef(snapshot, description)`: AI-powered element detection

### Supported Actions

- `browser_navigate`: Navigate to URLs
- `browser_click`: Click elements
- `browser_type`: Enter text
- `browser_wait_for`: Wait for conditions
- `browser_take_screenshot`: Capture screenshots
- `browser_evaluate`: Execute JavaScript
- `browser_snapshot`: Get page state

## 🔗 Integration

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### Docker Support

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "test"]
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) for the MCP specification
- [Playwright](https://playwright.dev/) for browser automation capabilities
- [OpenAI](https://openai.com/) for AI-powered natural language processing
- Contributors and the open-source community

## 📞 Support

- 📖 [Documentation](https://github.com/innoraft/Playwright-MCP-testing/wiki)
- 🐛 [Issue Tracker](https://github.com/innoraft/Playwright-MCP-testing/issues)
- 💬 [Discussions](https://github.com/innoraft/Playwright-MCP-testing/discussions)
- 📧 [Email Support](mailto:support@innoraft.com)

---

**Made with ❤️ by InnoRaft**