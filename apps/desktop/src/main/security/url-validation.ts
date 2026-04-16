/**
 * URL security utilities for validating external URL access
 */

const HTTPS_REQUIRED_DOMAINS: string[] = [
  // OAuth providers that must use HTTPS
  'accounts.google.com',
  'login.microsoftonline.com',
  // Other security-sensitive domains requiring HTTPS can be added here
];

/**
 * Trusted domains that can be opened via shell.openExternal
 */
const TRUSTED_DOMAINS: string[] = [
  // Documentation and help
  'github.com',
  'docs.github.com',
  'docs.anthropic.com',
  'platform.openai.com',
  'cloud.google.com',
  'console.aws.amazon.com',
  
  // OAuth providers
  'accounts.google.com',
  'login.microsoftonline.com',
  'oauth.slack.com',
  'gitlab.com',
  'bitbucket.org',
  
  // Developer tools
  'stackoverflow.com',
  'docs.microsoft.com',
];

/**
 * URL validation options
 */
export interface UrlValidationOptions {
  /**
   * If true, allows any HTTPS URL. Use for OAuth flows where the endpoint
   * is dynamically discovered from metadata.
   */
  allowAnyHttps?: boolean;
  
  /**
   * If true, requires HTTPS (fails for HTTP urls)
   */
  requireHttps?: boolean;
  
  /**
   * Additional domains to allow beyond the default trusted list
   */
  additionalTrustedDomains?: string[];
  
  /**
   * Context for error messages
   */
  context?: string;
}

/**
 * Validates a URL is safe to open externally
 * @throws Error if URL is not safe
 * @returns The parsed URL object
 */
export function validateExternalUrl(
  urlString: string,
  options: UrlValidationOptions = {},
): URL {
  const { 
    allowAnyHttps = false, 
    requireHttps = false, 
    additionalTrustedDomains = [],
    context = 'URL',
  } = options;

  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`${context} is not a valid URL: ${urlString}`);
  }

  // Protocol validation
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${context} must use http or https protocol (got: ${url.protocol})`);
  }

  // Check for HTTPS requirement
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error(`${context} must use https protocol for security`);
  }

  // Check hostname-specific HTTPS requirements
  if (url.protocol === 'http:' && HTTPS_REQUIRED_DOMAINS.includes(url.hostname)) {
    throw new Error(`${context} for ${url.hostname} must use https protocol`);
  }

  // If allowAnyHttps is enabled (OAuth flows), allow any HTTPS URL
  if (allowAnyHttps && url.protocol === 'https:') {
    return url;
  }

  // Check domain allowlist
  const allTrustedDomains = [...TRUSTED_DOMAINS, ...additionalTrustedDomains];
  const isHostnameAllowed = allTrustedDomains.some((trusted) => {
    // Exact match
    if (url.hostname === trusted) {
      return true;
    }
    // Subdomain match (e.g., 'api.github.com' matches 'github.com')
    if (url.hostname.endsWith(`.${trusted}`)) {
      return true;
    }
    return false;
  });

  if (!isHostnameAllowed) {
    throw new Error(
      `${context} domain is not in the trusted allowlist: ${url.hostname}`,
    );
  }

  return url;
}

/**
 * Validates a URL for OAuth authorization endpoints.
 * More permissive than general external URLs since OAuth metadata
 * endpoints are discovered from trusted MCP server configurations.
 */
export function validateOAuthUrl(urlString: string): URL {
  return validateExternalUrl(urlString, {
    allowAnyHttps: true,
    requireHttps: true,
    context: 'OAuth authorization URL',
  });
}

/**
 * Validates a general external URL (e.g., from user clicking a link)
 * Uses strict domain allowlist.
 */
export function validateGeneralExternalUrl(urlString: string): URL {
  return validateExternalUrl(urlString, {
    allowAnyHttps: false,
    requireHttps: false,
    context: 'External URL',
  });
}
