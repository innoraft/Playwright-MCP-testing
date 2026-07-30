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

### Quick Start (3 Steps)

1. **Install runner + backend dependencies** (from project root):
```bash
npm install
```

2. **Install frontend dependencies**:
```bash
cd client && npm install
```

3. **Configure your LLM provider** — open `config/llm.config.js` and add your API key:

```javascript
const llmConfig = {
  provider: 'openai',
  model: '', // Use new models (e.g. gpt-5.1-codex-max or gpt-5)
  apiKey: 'your-api-key-here',
  temperature: 1
};

export default llmConfig;
```

> No Docker, database, or cloud account required to get started.

### Starting the Platform

Open **two terminal windows**:

**Terminal 1 — Backend server:**
```bash
node server/index.js
```
Server starts on `http://localhost:3001`.

**Terminal 2 — Frontend dev server:**
```bash
cd client && npm run dev
```
Frontend opens on `http://localhost:5173`.
## 📝 Usage

### Basic Test Creation

Create a test file (e.g., `tests/simple-test.test.yml`) with natural language instructions:

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

Execute a general test:

```bash
node ai_tool_runner.js tests/alert-test.test.yml
```

Execute a visual regression test:

```bash
node ai_visual_runner.js tests/innoraft.test.yml
```

Execute a performance metrics test:

```bash
node ai_lighthouse_runner.js tests/inno_perf.test.yml
```

The server now auto-selects the correct runner by test type:
- General tests use `ai_tool_runner.js`
- Visual regression tests use `ai_visual_runner.js`
- Performance tests use `ai_lighthouse_runner.js`

### Uploading media

If you want to upload any files then at first place them inside the `/files/uploads/` directory
Then use the absolute path to the test step e.g. `- Select the file from the system path '/home/abc/Desktop/playwright-mcp/files/uploads/abc.png'`

### Test Report

After execution, you'll get:
- Detailed console output with step-by-step execution
- HTML report with screenshots and analytics
- Test reports saved in `test-reports/` directory
- Screenshots saved in `/files/test-screenshots/` directory

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

4. **Prefer Stable Selectors**: Use attributes that are less likely to change
  ```
  ✅ Click the button with id "submit-order"
  ✅ Type "john" into the input with placeholder "Username"
  ❌ Click the blue button on the right
  ```

5. **Use Placeholders and Labels When Possible**: These are more reliable than visual descriptions.
  ```
  ✅ Enter "john@example.com" in the input with placeholder "Email"
  ✅ Type "admin" into the field labeled "Username"
  ❌ Type into the first input box
  ```

6. **Avoid Position-Based Targeting**: UI layout can change; avoid relying on order.
  ```
  ❌ Click the second button
  ❌ Select the third input field
  ✅ Click the button with text "Save"
  ```

7. **Use Text Content for Buttons and Links**: Text is more stable than layout or styling.
  ```
  ✅ Click the "Login" button
  ✅ Click the link "Forgot Password"
  ❌ Click the top-right link
  ```

8. **Prefer IDs and Data Attributes When Available**: 
  ```
  ✅ Click the element with id "submitBtn"
  ✅ Click the element with data-test-id "login-submit"
  ❌ Click the green button
  ```
9. **Describe the Field Purpose, Not Its Appearance**:
  ```
  ✅ Enter "12345" in the ZIP code field
  ❌ Enter "12345" in the small box on the left
  ```

10. **Be Explicit About Which Element You Mean When There Are Multiple Matches**:
  ```
  ✅ Click the "Edit" button for the user "John"
  ❌ Click the "Edit" button
  ```

11. **Use Clear Assertion Targets**:
  ```
  ✅ Verify that the text "Order Placed" is visible
  ✅ Verify that the URL contains "/dashboard"
  ❌ Verify the page looks correct
  ```

12. **Avoid Vague Terms**:
  ```
  ❌ Click something
  ❌ Enter some text
  ✅ Click the "Checkout" button
  ✅ Enter "98765" in the ZIP code field
  ```

### Test Organization

- Group related tests in logical directories
- Use descriptive test file names
- Include setup and teardown steps

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
DEBUG=true node ai_visual_runner.js tests/innoraft.test.yml
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

- `generateExecutionPlan(testText, testSteps)`: Generates the execution plan by calling LLM
- `runTest(testText, testName)`: PRuns the tools following the plan
- `recordAction({ tool, params, status, assertion, error, duration, screenshot })`: Records the step is passed or failed

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