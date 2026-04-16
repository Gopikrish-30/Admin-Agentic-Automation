import crypto from 'crypto';

export interface TelegramPairing {
  chatId: number;
  userId: number;
  username?: string;
  firstName?: string;
  pairedAt: string;
  lastActiveAt: string;
  sessionToken: string;
}

export interface TelegramConfig {
  botToken: string;
  pairing: TelegramPairing | null;
  enabled: boolean;
}

export interface PendingPairingRequest {
  id: string;
  chatId: number;
  userId: number;
  username?: string;
  firstName?: string;
  requestedAt: number;
  expiresAt: number;
}

// ── PIN state ──────────────────────────────────────────────────
let currentPin: string | null = null;
let pinExpiresAt: number = 0;

const PIN_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes

// ── Rate limiting ──────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
let failedAttempts: number[] = [];

// ── Pending pairing ───────────────────────────────────────────
const PENDING_PAIRING_TTL_MS = 2 * 60 * 1000; // 2 minutes to approve
let pendingPairing: PendingPairingRequest | null = null;

// ── Session expiry ────────────────────────────────────────────
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days of inactivity

export function generatePairingPin(): string {
  currentPin = crypto.randomInt(100000, 999999).toString();
  pinExpiresAt = Date.now() + PIN_VALIDITY_MS;
  return currentPin;
}

function isRateLimited(): boolean {
  const now = Date.now();
  failedAttempts = failedAttempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  return failedAttempts.length >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(): void {
  failedAttempts.push(Date.now());
}

export function getRateLimitStatus(): { limited: boolean; remainingMs: number } {
  const now = Date.now();
  failedAttempts = failedAttempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (failedAttempts.length < MAX_FAILED_ATTEMPTS) {
    return { limited: false, remainingMs: 0 };
  }
  const oldestRelevant = failedAttempts[0];
  return { limited: true, remainingMs: RATE_LIMIT_WINDOW_MS - (now - oldestRelevant) };
}

/**
 * Validate a PIN sent from Telegram. Returns 'valid', 'invalid', or 'rate_limited'.
 * Does NOT consume the PIN — the pairing must still be approved by the desktop user.
 */
export function validatePairingPin(pin: string): 'valid' | 'invalid' | 'rate_limited' {
  if (isRateLimited()) {
    return 'rate_limited';
  }

  if (!currentPin || Date.now() > pinExpiresAt) {
    currentPin = null;
    recordFailedAttempt();
    return 'invalid';
  }

  // Constant-time comparison to prevent timing attacks
  const isValid =
    pin.length === currentPin.length &&
    crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(currentPin));

  if (!isValid) {
    recordFailedAttempt();
    return 'invalid';
  }

  // PIN is valid — consume it so it can't be reused
  currentPin = null;
  pinExpiresAt = 0;
  return 'valid';
}

/**
 * Create a pending pairing request that needs desktop-side approval.
 */
export function createPendingPairing(
  chatId: number,
  userId: number,
  username?: string,
  firstName?: string,
): PendingPairingRequest {
  const now = Date.now();
  pendingPairing = {
    id: crypto.randomUUID(),
    chatId,
    userId,
    username,
    firstName,
    requestedAt: now,
    expiresAt: now + PENDING_PAIRING_TTL_MS,
  };
  return pendingPairing;
}

export function getPendingPairing(): PendingPairingRequest | null {
  if (!pendingPairing) {
    return null;
  }
  if (Date.now() > pendingPairing.expiresAt) {
    pendingPairing = null;
    return null;
  }
  return pendingPairing;
}

/**
 * Approve the pending pairing and generate a secure session.
 */
export function approvePendingPairing(requestId: string): TelegramPairing | null {
  const pending = getPendingPairing();
  if (!pending || pending.id !== requestId) {
    return null;
  }

  const pairing: TelegramPairing = {
    chatId: pending.chatId,
    userId: pending.userId,
    username: pending.username,
    firstName: pending.firstName,
    pairedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    sessionToken: crypto.randomBytes(32).toString('hex'),
  };

  pendingPairing = null;
  return pairing;
}

export function denyPendingPairing(requestId: string): boolean {
  const pending = getPendingPairing();
  if (!pending || pending.id !== requestId) {
    return false;
  }
  pendingPairing = null;
  return true;
}

/**
 * Check if a session is still valid (not expired due to inactivity).
 */
export function isSessionValid(pairing: TelegramPairing): boolean {
  const lastActive = new Date(pairing.lastActiveAt).getTime();
  return Date.now() - lastActive < SESSION_EXPIRY_MS;
}

/**
 * Update the last active timestamp on a pairing.
 */
export function touchSession(pairing: TelegramPairing): TelegramPairing {
  return { ...pairing, lastActiveAt: new Date().toISOString() };
}

export function getCurrentPin(): string | null {
  if (!currentPin || Date.now() > pinExpiresAt) {
    currentPin = null;
    return null;
  }
  return currentPin;
}

export function clearPin(): void {
  currentPin = null;
  pinExpiresAt = 0;
  pendingPairing = null;
}
