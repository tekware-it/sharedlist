# rate_limit_redis.py
import os
from fastapi import HTTPException
from redis.asyncio import Redis


async def rate_limit(
    redis: Redis,
    key: str,
    max_requests: int,
    window_seconds: int = 60,
) -> None:
    """Simple fixed-window rate limiting using Redis INCR/EXPIRE.

    Args:
        redis: Redis client.
        key: logical key, e.g. "ip:1.2.3.4" or "client_write:client-xyz".
        max_requests: maximum allowed requests in the window.
        window_seconds: size of the time window in seconds.
    """

    # In dev/test we may want to disable IP-based rate limits
    if key.startswith("ip:") and os.getenv("DISABLE_IP_RATE_LIMIT", "0") == "1":
        return

    redis_key = f"rl:{key}"
    current = await redis.incr(redis_key)
    if current == 1:
        # first request in window, set expiry
        await redis.expire(redis_key, window_seconds)

    if current > max_requests:
        raise HTTPException(
            status_code=429,
            detail="Too many requests, please slow down",
        )
