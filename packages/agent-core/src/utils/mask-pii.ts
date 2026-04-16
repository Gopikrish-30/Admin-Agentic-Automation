/**
 * Permanently masks PII (Personally Identifiable Information) in text.
 * Applied before writing to storage — original data is not recoverable.
 */

// --- Pattern definitions ---

// Email: user@domain.tld
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Phone: international and local formats
// Matches: +1-234-567-8901, +91 98765 43210, (234) 567-8901, 234-567-8901, +44 7911 123456
const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{1,4})?/g;

// Credit card: 13-19 digits with optional separators (spaces, dashes)
const CREDIT_CARD_PATTERN = /\b(?:\d[\s-]?){12,18}\d\b/g;

// US SSN: xxx-xx-xxxx
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

// Aadhaar (India): 12-digit number with optional spaces (xxxx xxxx xxxx)
const AADHAAR_PATTERN = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

// OTP/verification codes: 4-8 digit codes preceded by trigger keywords
// Only matches digits that appear near keywords to reduce false positives
const OTP_PATTERN =
  /(?:otp|verification\s*code|verify\s*code|pin\s*code|passcode|one[- ]?time\s*(?:password|code|pin)|security\s*code|confirm(?:ation)?\s*code|mfa\s*code|2fa\s*code|auth(?:entication)?\s*code)[:\s]+(\d{4,8})\b/gi;

// Keyword-context phone: digits (4+) near phone-related keywords
// Catches short numbers like "123567 is phone number" or "call me at 98765"
// Pattern A: keyword followed by digits — "phone number is 123567"
const KEYWORD_PHONE_BEFORE_PATTERN =
  /(?:phone|mobile|cell|contact|whatsapp|tel(?:ephone)?|dial|call(?:\s+(?:me|us))?(?:\s+at)?|my\s*(?:number|no))[\s:.\-=]*(?:number|no\.?|#)?[\s:.\-=]*(?:is)?[\s:.\-=]*(\d{4,15})/gi;
// Pattern B: digits followed by keyword — "123567 is phone number" / "123567 is my number"
const KEYWORD_PHONE_AFTER_PATTERN =
  /(\d{4,15})\s+(?:is\s+)?(?:(?:my|a|the)\s+)?(?:phone|mobile|cell|contact|whatsapp|tel(?:ephone)?)\s*(?:number|no\.?|#)?/gi;

// US ZIP codes: 5-digit or 5+4 format
const ZIP_CODE_PATTERN = /\b\d{5}(?:-\d{4})?\b/g;

// Street addresses: number + street name + optional type (St, Ave, Blvd, etc.)
const STREET_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Road|Rd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Highway|Hwy)\b\.?/gi;

// UK postcodes: A9 9AA, A99 9AA, A9A 9AA, AA9 9AA, AA99 9AA, AA9A 9AA
const UK_POSTCODE_PATTERN = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

// Indian PIN codes: 6-digit postal codes
const INDIAN_PIN_PATTERN = /\b[1-9]\d{5}\b/g;

/**
 * Helper to filter phone-like matches: must have at least 7 actual digits
 * to avoid false positives on short number sequences.
 */
function isLikelyPhone(match: string): boolean {
  const digitsOnly = match.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/**
 * Helper to validate credit card numbers using the Luhn algorithm.
 * Reduces false positives on arbitrary long digit sequences.
 */
function passesLuhnCheck(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Masks all PII in the given text. Replacements are permanent.
 * Returns the text with PII replaced by labeled placeholders.
 */
export function maskPii(text: string): string {
  if (!text) {
    return text;
  }

  let result = text;

  // Order matters: more specific patterns first to avoid overlap

  // 1. Email (very specific, unlikely false positives)
  result = result.replace(EMAIL_PATTERN, '[EMAIL]');

  // 2. OTP / verification codes (keyword-context, applied before generic digit patterns)
  result = result.replace(OTP_PATTERN, (match, digits: string) => {
    return match.replace(digits, '[OTP]');
  });

  // 2b. Keyword-context phone numbers (catches short numbers near "phone", "mobile", etc.)
  result = result.replace(KEYWORD_PHONE_BEFORE_PATTERN, (match, digits: string) => {
    return match.replace(digits, '[PHONE]');
  });
  result = result.replace(KEYWORD_PHONE_AFTER_PATTERN, (match, digits: string) => {
    return match.replace(digits, '[PHONE]');
  });

  // 3. SSN (US format xxx-xx-xxxx)
  result = result.replace(SSN_PATTERN, '[SSN]');

  // 4. Credit card numbers (Luhn-validated)
  result = result.replace(CREDIT_CARD_PATTERN, (match) => {
    return passesLuhnCheck(match) ? '[CARD]' : match;
  });

  // 5. Aadhaar (12-digit Indian ID)
  result = result.replace(AADHAAR_PATTERN, '[SSN]');

  // 6. Street addresses (before phone, since addresses can contain numbers)
  result = result.replace(STREET_ADDRESS_PATTERN, '[ADDRESS]');

  // 7. UK postcodes (keep before phone)
  result = result.replace(UK_POSTCODE_PATTERN, '[ADDRESS]');

  // 8. Phone numbers (with digit-count validation)
  result = result.replace(PHONE_PATTERN, (match) => {
    // Bypass exactly 5-dash-4 formats so they can be picked up by ZIP masks below
    if (/^\d{5}-\d{4}$/.test(match.trim())) {
      return match;
    }
    return isLikelyPhone(match) ? '[PHONE]' : match;
  });

  // 9. Standard 5/6 digit postal codes (after phone to avoid breaking spaced numbers)
  result = result.replace(ZIP_CODE_PATTERN, '[ZIP]');
  result = result.replace(INDIAN_PIN_PATTERN, '[ZIP]');

  return result;
}
