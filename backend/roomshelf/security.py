import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import tempfile
import unicodedata
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from encodings.idna import nameprep
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

from flask import Flask, current_app, request, session
from flask.sessions import SecureCookieSessionInterface, SessionMixin
from itsdangerous import BadData, URLSafeSerializer
from sqlalchemy.orm import Session

from .errors import ApiError
from .models import AnonymousShortlist

SESSION_LIFETIME = timedelta(days=30)
CSRF_LIFETIME = timedelta(hours=1)
HEX_KEY = re.compile(r"[0-9a-f]{64}")
DNS_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
IPV4_NUMBER = re.compile(r"(?:[0-9]+|0x[0-9a-f]*)")


def timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def now() -> datetime:
    clock = cast(Callable[[], datetime], current_app.config["ROOMSHELF_CLOCK"])
    return clock().astimezone(UTC)


class AbsoluteSessionInterface(SecureCookieSessionInterface):
    def get_expiration_time(self, app: Flask, session: SessionMixin) -> datetime | None:
        expiry = session.get("expires_at")
        return parse_timestamp(expiry) if isinstance(expiry, str) else None


def _development_secret(path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        # Publish a complete file atomically without replacing another process's key.
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as temporary:
            temporary.write(secrets.token_hex(32))
            temporary_path = Path(temporary.name)
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            pass
        finally:
            temporary_path.unlink()
    return path.read_text().strip()


def _canonical_hostname(host: str) -> bool:
    try:
        return host == str(ipaddress.IPv4Address(host))
    except ipaddress.AddressValueError:
        pass
    # Browsers interpret a numeric final label as IPv4, including hex/octal and
    # shortened forms. Only the dotted decimal form above is accepted.
    domain = host.removesuffix(".")
    labels = domain.split(".")
    return (
        len(domain) <= 253
        and all(_valid_dns_label(label) for label in labels)
        and IPV4_NUMBER.fullmatch(labels[-1]) is None
    )


def _valid_dns_label(label: str) -> bool:
    if DNS_LABEL.fullmatch(label) is None:
        return False
    if not label.startswith("xn--"):
        return True
    try:
        decoded = label[4:].encode("ascii").decode("punycode")
        if (
            not decoded
            or unicodedata.category(decoded[0]).startswith("M")
            or any(unicodedata.category(character).startswith("C") for character in decoded)
        ):
            return False
        # Conservatively reject mixed-direction labels using current Unicode,
        # including scripts newer than the stdlib IDNA2003 tables.
        directions = [unicodedata.bidirectional(character) for character in decoded]
        if any(direction in {"R", "AL"} for direction in directions):
            ending = next(
                (direction for direction in reversed(directions) if direction != "NSM"), ""
            )
            if (
                directions[0] not in {"R", "AL"}
                or "L" in directions
                or ending not in {"R", "AL", "EN", "AN"}
                or ("EN" in directions and "AN" in directions)
            ):
                return False
        # Require unmapped ACE labels, except the IDNA2008 deviations ß and ς.
        # Contextual joiners are deliberately unsupported rather than silently
        # removed by IDNA2003 nameprep. No configuration value is normalized.
        if nameprep(decoded) != decoded.replace("ß", "ss").replace("ς", "σ"):
            return False
        decoded.encode("idna")
        return not decoded.isascii() and decoded.encode("punycode").decode("ascii") == label[4:]
    except UnicodeError:
        return False


def _browser_ipv6(address: ipaddress.IPv6Address) -> str:
    # Python renders IPv4-mapped IPv6 with dotted decimal; browsers use hex.
    words = [f"{int.from_bytes(address.packed[index : index + 2]):x}" for index in range(0, 16, 2)]
    best_start, best_length, start = 0, 0, 0
    for end in range(len(words) + 1):
        if end < len(words) and words[end] == "0":
            continue
        if end - start > best_length:
            best_start, best_length = start, end - start
        start = end + 1
    if best_length < 2:
        return ":".join(words)
    return ":".join(words[:best_start]) + "::" + ":".join(words[best_start + best_length :])


def _is_canonical_origin(origin: str, *, production: bool) -> bool:
    # urlsplit strips some controls and accepts authorities a browser would
    # rewrite. Compare a reconstructed canonical origin without changing config.
    if not origin.isascii() or any(
        ord(character) <= 32 or ord(character) == 127 for character in origin
    ):
        return False
    try:
        parsed = urlsplit(origin)
        host, port = parsed.hostname, parsed.port
        if (
            parsed.scheme not in ({"https"} if production else {"http", "https"})
            or host is None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or (port is not None and not 1 <= port <= 65535)
            or port == (443 if parsed.scheme == "https" else 80)
        ):
            return False
        if parsed.netloc.startswith("["):
            if "%" in host:
                return False
            authority = f"[{_browser_ipv6(ipaddress.IPv6Address(host))}]"
        elif _canonical_hostname(host):
            authority = host
        else:
            return False
        if port is not None:
            authority += f":{port}"
        return origin == f"{parsed.scheme}://{authority}"
    except ValueError:
        return False


def configure_security(app: Flask) -> None:
    environment = app.config["ROOMSHELF_ENV"]
    if environment not in {"development", "production"}:
        raise ValueError("ROOMSHELF_ENV must be development or production.")
    production = environment == "production"
    secret = app.config.get("SECRET_KEY")
    if not secret and not production:
        secret = _development_secret(Path(app.instance_path) / "session-secret")
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError("ROOMSHELF_SECRET_KEY must contain at least 32 characters.")
    origin = app.config.get("PUBLIC_ORIGIN")
    if origin is None and not production:
        origin = "http://localhost:5173"
    if not isinstance(origin, str):
        raise ValueError("ROOMSHELF_PUBLIC_ORIGIN must be a string and is required in production.")
    if not _is_canonical_origin(origin, production=production):
        raise ValueError(
            "ROOMSHELF_PUBLIC_ORIGIN must be a canonical origin with a valid ASCII host "
            "and no explicit default, empty, or padded port (HTTPS in production)."
        )
    app.config.update(
        SECRET_KEY=secret,
        PUBLIC_ORIGIN=origin,
        SESSION_COOKIE_NAME="__Host-roomshelf_session" if production else "roomshelf_session",
        SESSION_COOKIE_SECURE=production,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_PATH="/",
        SESSION_COOKIE_DOMAIN=None,
        SESSION_REFRESH_EACH_REQUEST=False,
        PERMANENT_SESSION_LIFETIME=SESSION_LIFETIME,
    )
    app.session_interface = AbsoluteSessionInterface()


def validate_origin(*, required: bool) -> None:
    origin = request.headers.get("Origin")
    if (required or origin is not None) and origin != current_app.config["PUBLIC_ORIGIN"]:
        raise ApiError(403, "origin_forbidden", "Request origin is not allowed.")
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise ApiError(403, "origin_forbidden", "Request origin is not allowed.")


def cookie_identity() -> tuple[str, str, str] | None:
    key, nonce, expiry = (session.get(field) for field in ("key", "nonce", "expires_at"))
    if not all(isinstance(value, str) for value in (key, nonce, expiry)):
        return None
    key, nonce, expiry = cast(str, key), cast(str, nonce), cast(str, expiry)
    if HEX_KEY.fullmatch(key) is None or HEX_KEY.fullmatch(nonce) is None:
        return None
    try:
        if parse_timestamp(expiry) <= now():
            return None
    except (ValueError, OverflowError):
        return None
    return key, nonce, expiry


def active_shortlist(database: Session) -> AnonymousShortlist | None:
    identity = cookie_identity()
    if identity is None:
        return None
    shortlist = database.get(AnonymousShortlist, identity[0])
    if (
        shortlist is None
        or shortlist.expires_at != identity[2]
        or parse_timestamp(shortlist.expires_at) <= now()
    ):
        return None
    return shortlist


def require_shortlist(database: Session) -> AnonymousShortlist:
    shortlist = active_shortlist(database)
    if shortlist is None:
        raise ApiError(401, "session_required", "An active shortlist session is required.")
    return shortlist


def _digest(purpose: str, value: str) -> str:
    secret = cast(str, current_app.config["SECRET_KEY"]).encode()
    return hmac.new(secret, f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def session_ref(key: str) -> str:
    return _digest("public-session-ref", key)


def _csrf_binding() -> str:
    identity = cookie_identity()
    if identity is None:
        raise ApiError(401, "session_required", "An active shortlist session is required.")
    return _digest("csrf-binding", f"{identity[0]}:{identity[1]}")


def _csrf_serializer() -> URLSafeSerializer:
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt="roomshelf-csrf-v1")


def session_payload(shortlist: AnonymousShortlist) -> dict[str, Any]:
    expires = min(now() + CSRF_LIFETIME, parse_timestamp(shortlist.expires_at))
    token = _csrf_serializer().dumps({"binding": _csrf_binding(), "expires_at": timestamp(expires)})
    return {
        "session_ref": session_ref(shortlist.key),
        "csrf_token": token,
        "csrf_expires_at": timestamp(expires),
        "session_expires_at": shortlist.expires_at,
    }


def validate_csrf() -> None:
    token = request.headers.get("X-CSRF-Token", "")
    try:
        if not token or len(token) > 2048:
            raise ValueError("Missing or oversized token.")
        payload = _csrf_serializer().loads(token)
        if not isinstance(payload, dict) or set(payload) != {"binding", "expires_at"}:
            raise ValueError("Invalid token shape.")
        binding, expiry = payload["binding"], payload["expires_at"]
        if (
            not isinstance(binding, str)
            or not isinstance(expiry, str)
            or not hmac.compare_digest(binding, _csrf_binding())
            or parse_timestamp(expiry) <= now()
        ):
            raise ValueError("Invalid or expired token.")
    except (BadData, ValueError, OverflowError, TypeError) as error:
        raise ApiError(
            403, "csrf_invalid", "CSRF token is missing, invalid, or expired."
        ) from error
