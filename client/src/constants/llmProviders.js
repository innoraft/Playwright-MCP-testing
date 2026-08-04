// ── Provider → Model mapping ──────────────────────────
export const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'gemini', label: 'Gemini (Google)' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'cohere', label: 'Cohere' },
];

export const MODELS_BY_PROVIDER = {
  openai: [
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-mini', label: 'GPT-5-mini' },
    { value: 'gpt-4o-mini', label: 'GPT-4o-mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-5.1-codex-max', label: 'GPT-5.1-codex-max' },
    { value: 'gpt-5.2-codex', label: 'GPT-5.2-codex' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3-codex' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.5', label: 'GPT-5.5' }
  ],
  anthropic: [
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' },
    { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  ],
  mistral: [
    { value: 'mistral-large-latest', label: 'Mistral Large' },
    { value: 'mistral-small-latest', label: 'Mistral Small' },
    { value: 'open-mistral-nemo', label: 'Mistral Nemo' },
  ],
  cohere: [
    { value: 'command-r-plus', label: 'Command R+' },
    { value: 'command-r', label: 'Command R' },
    { value: 'command-light', label: 'Command Light' },
  ],
};
