from typing import Any

from flask import Flask, Response, jsonify
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list[dict[str, str]] | None = None,
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []
        super().__init__(message)


def invalid_request(field: str, message: str) -> ApiError:
    return ApiError(
        400, "invalid_request", "Request validation failed.", [{"field": field, "message": message}]
    )


def register_error_handlers(app: Flask) -> None:
    def response(error: ApiError) -> tuple[Response, int]:
        return jsonify(
            error={"code": error.code, "message": error.message, "details": error.details}
        ), error.status

    app.register_error_handler(ApiError, response)

    @app.errorhandler(HTTPException)
    def http_error(error: HTTPException) -> tuple[Response, int]:
        codes = {
            400: "invalid_request",
            404: "route_not_found",
            405: "method_not_allowed",
            413: "body_too_large",
            415: "unsupported_media_type",
        }
        status = error.code or 500
        json_response, status = response(
            ApiError(status, codes.get(status, "http_error"), error.name)
        )
        for name, value in error.get_response().headers.items():
            if name.lower() not in {"content-type", "content-length"}:
                json_response.headers.add(name, value)
        return json_response, status

    @app.errorhandler(OperationalError)
    def database_error(error: OperationalError) -> tuple[Response, int]:
        busy = "locked" in str(error.orig).lower() or "busy" in str(error.orig).lower()
        return response(
            ApiError(
                503,
                "database_busy" if busy else "database_unavailable",
                "Database is temporarily busy." if busy else "Database is unavailable.",
            )
        )

    @app.errorhandler(SQLAlchemyError)
    @app.errorhandler(Exception)
    def unexpected_error(error: Any) -> tuple[Response, int]:
        app.logger.error("Unexpected request failure (%s)", type(error).__name__)
        return response(ApiError(500, "internal_error", "An unexpected error occurred."))
