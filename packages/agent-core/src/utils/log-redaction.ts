const REDACTION = '[REDACTED]';

const TOKEN_ASSIGNMENT_REGEX =
  /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|password)["']?\s*[:=]\s*["']?)([^"'\s,}\]]+)(["']?)/gi;

const PROVIDER_ENV_REGEX =
  /((?:OPENAI|ANTHROPIC|OPENROUTER|GOOGLE|XAI|DEEPSEEK|MOONSHOT|ZAI|AZURE|AWS|BEDROCK|LITELLM|GROQ|ELEVENLABS|BRAVE)_[A-Z0-9_]*\s*=\s*)([^\s]+)/g;

const AUTH_HEADER_REGEX = /(authorization\s*[:=]\s*bearer\s+)([^\s"']+)/gi;

const BEARER_REGEX = /(\bbearer\s+)([a-z0-9._~+/-]+=*)/gi;

const SK_PREFIX_REGEX = /\bsk-(?:proj|ant|live|test)?[a-z0-9_-]{10,}\b/gi;

export function redactSensitiveText(input: string): string {
  if (!input) {
    return input;
  }

  return input
    .replace(TOKEN_ASSIGNMENT_REGEX, `$1${REDACTION}$3`)
    .replace(PROVIDER_ENV_REGEX, `$1${REDACTION}`)
    .replace(AUTH_HEADER_REGEX, `$1${REDACTION}`)
    .replace(BEARER_REGEX, `$1${REDACTION}`)
    .replace(SK_PREFIX_REGEX, REDACTION);
}
