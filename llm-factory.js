import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Centralized LLM factory
 * - Provider + API key required
 * - Model is provided dynamically via config
 * - Safe defaults per provider
 */
export function createLLM({ provider, apiKey, model }) {
  if (!provider) {
    throw new Error('LLM provider is required');
  }

  if (!apiKey) {
    throw new Error(`API key missing for provider: ${provider}`);
  }

  switch (provider) {
    case 'openai': {
      const openaiProvider = createOpenAI({ apiKey });

      return openaiProvider(
        model || 'gpt-5'
      );
    }

    case 'gemini': {
      const googleProvider = createGoogleGenerativeAI({ apiKey });

      return googleProvider(
        model || 'gemini-2.5-flash'
      );
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
