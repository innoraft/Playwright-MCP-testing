import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Centralized LLM factory
 * - Only accepts provider + apiKey
 * - Model selection is fully locked here
 * - Prevents misconfiguration and downgrade
 */
export function createLLM({ provider, apiKey }) {
  if (!provider) {
    throw new Error('LLM provider is required');
  }

  if (!apiKey) {
    throw new Error(`API key missing for provider: ${provider}`);
  }

  switch (provider) {
    case 'openai':
      const openaiProvider = createOpenAI({ apiKey: apiKey });
      return openaiProvider('gpt-5'); //If facing any problem or ambiguity, feel free to use `gpt5` instead of `gpt-5.1-codex-max`

    case 'gemini':
      const googleProvider = createGoogleGenerativeAI({ apiKey });
      return googleProvider('gemini-2.5-flash');

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
