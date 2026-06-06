import { Redis } from "ioredis";

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || "redis://localhost:6390", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }
  return _redis;
}

const WINDOW_SECONDS = 15 * 60; // 15 minutes
const MAX_FAILURES = 5;

function failKey(email: string, ip: string) {
  return `login:fail:${email}:${ip}`;
}

/** Returns { limited: true, retryAfter } when the caller should be blocked. */
export async function checkLoginRateLimit(
  email: string,
  ip: string
): Promise<{ limited: false } | { limited: true; retryAfter: number }> {
  try {
    const key = failKey(email, ip);
    const count = await redis().get(key);
    if (count && parseInt(count, 10) >= MAX_FAILURES) {
      const ttl = await redis().ttl(key);
      return { limited: true, retryAfter: Math.max(ttl, 1) };
    }
    return { limited: false };
  } catch {
    // Redis unavailable → fail open (don't block logins)
    return { limited: false };
  }
}

/** Call on every failed login attempt. */
export async function recordLoginFailure(
  email: string,
  ip: string
): Promise<void> {
  try {
    const key = failKey(email, ip);
    const pipe = redis().pipeline();
    pipe.incr(key);
    pipe.expire(key, WINDOW_SECONDS, "NX"); // only set TTL on first failure
    await pipe.exec();
  } catch {
    /* ignore Redis errors */
  }
}

/** Call on successful login to reset the counter. */
export async function clearLoginFailures(
  email: string,
  ip: string
): Promise<void> {
  try {
    await redis().del(failKey(email, ip));
  } catch {
    /* ignore */
  }
}
