const MOCK_ADMIN_PROMPT_PREFIX = 'You are executing a mock IT admin automation request against ';

export function sanitizePromptForDisplay(text: string): string {
  if (!text || !text.startsWith(MOCK_ADMIN_PROMPT_PREFIX)) {
    return text;
  }

  const match = text.match(/(?:\r?\n)User request:\s*([\s\S]*)$/i);
  const extracted = match?.[1]?.trim();
  return extracted && extracted.length > 0 ? extracted : text;
}
