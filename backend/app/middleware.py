import ipaddress
import re
from collections.abc import Callable, Sequence

from fastapi import status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# All loopback prefixes that are considered "localhost" originating traffic.
_LOOPBACK_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),   # IPv4 loopback range
    ipaddress.ip_network("::1/128"),        # IPv6 loopback
)

# Matches Origins/Referers like http://localhost, http://localhost:5173, http://127.0.0.1:5173
_LOCALHOST_URL_RE = re.compile(
    r"^https?://(localhost|127\.\d+\.\d+\.\d+)(:\d+)?(/.*)?"
)


def _is_loopback(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _LOOPBACK_NETWORKS)
    except ValueError:
        return False


def _real_client_ip(request: Request) -> str | None:
    """Return the real client IP, preferring the first entry in X-Forwarded-For
    (set by proxies such as AWS App Runner's load balancer) over the raw TCP
    connection host."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else None


def _has_localhost_signal(request: Request) -> bool:
    """Return True when any header reveals the request originated from localhost.

    Three signals are checked:
    - TCP client IP is a loopback address (direct local call).
    - ``Origin`` header is a localhost URL (browser cross-origin call without proxy).
    - ``Referer`` header is a localhost URL (browser same-origin call through a
      dev proxy such as Vite with changeOrigin:true, which strips the Origin
      header but forwards Referer unchanged).
    """
    client_ip = _real_client_ip(request)
    if client_ip and _is_loopback(client_ip):
        return True

    for header in ("origin", "referer"):
        value = request.headers.get(header, "")
        if value and _LOCALHOST_URL_RE.match(value):
            return True

    return False


class LocalhostBlockMiddleware(BaseHTTPMiddleware):
    """Block requests that originate from localhost unless the real client IP
    is in the whitelist."""

    def __init__(self, app, whitelist: Sequence[str] = ()) -> None:
        super().__init__(app)
        self._whitelist: frozenset[str] = frozenset(whitelist)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip = _real_client_ip(request)

        if _has_localhost_signal(request) and client_ip not in self._whitelist:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Access from localhost is not permitted."},
            )

        return await call_next(request)
