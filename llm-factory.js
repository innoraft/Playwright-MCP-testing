import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMistral } from '@ai-sdk/mistral';
import { createCohere } from '@ai-sdk/cohere';

/**
 * Centralized LLM factory
 * - Supports: OpenAI, Gemini, Claude (Anthropic), Groq, Mistral, Cohere
 * - Provider + API key required
 * - Model is provided dynamically via config
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
      return openaiProvider(model || 'gpt-5');
    }

    case 'gemini': {
      const googleProvider = createGoogleGenerativeAI({ apiKey });
      return googleProvider(model || 'gemini-2.5-flash');
    }

    case 'anthropic': {
      const anthropicProvider = createAnthropic({ apiKey });
      return anthropicProvider(model || 'claude-sonnet-4-20250514');
    }

    case 'groq': {
      // Groq uses OpenAI-compatible API
      const groqProvider = createOpenAI({
        apiKey,
        baseURL: 'https://api.groq.com/openai/v1',
      });
      return groqProvider(model || 'llama-3.3-70b-versatile');
    }

    case 'mistral': {
      const mistralProvider = createMistral({ apiKey });
      return mistralProvider(model || 'mistral-large-latest');
    }

    case 'cohere': {
      const cohereProvider = createCohere({ apiKey });
      return cohereProvider(model || 'command-r-plus');
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
