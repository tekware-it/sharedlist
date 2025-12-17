# security_headers.py
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add a few basic security-related HTTP response headers.

    These matter mostly for browser clients; mobile apps are unaffected,
    but it's still good practice.
    """

    async def dispatch(self, request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response
