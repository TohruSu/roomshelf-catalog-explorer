import os
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from flask import Flask, request

from .catalog import api
from .cli import register_commands
from .db import make_engine
from .errors import register_error_handlers
from .security import configure_security
from .shortlist import personal


def create_app(config: Mapping[str, Any] | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    default_database = Path(app.instance_path) / "catalog.sqlite3"
    app.config.from_mapping(
        DATABASE_URL=os.environ.get("ROOMSHELF_DATABASE_URL", f"sqlite:///{default_database}"),
        MAX_CONTENT_LENGTH=4096,
        DEBUG=False,
        ROOMSHELF_ENV=os.environ.get("ROOMSHELF_ENV", "development"),
        SECRET_KEY=os.environ.get("ROOMSHELF_SECRET_KEY"),
        PUBLIC_ORIGIN=os.environ.get("ROOMSHELF_PUBLIC_ORIGIN"),
        ROOMSHELF_CLOCK=lambda: datetime.now(UTC),
    )
    if config:
        app.config.update(config)
    configure_security(app)
    app.extensions["roomshelf_engine"] = make_engine(app.config["DATABASE_URL"])
    app.register_blueprint(api)
    app.register_blueprint(personal)
    register_commands(app)
    register_error_handlers(app)

    @app.after_request
    def security_headers(response: Any) -> Any:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        if request.path == "/api" or request.path.startswith("/api/"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'"
            )
        if request.path == "/api/session" or request.path.startswith("/api/shortlist"):
            response.headers["Cache-Control"] = "no-store"
            response.vary.add("Cookie")
        return response

    return app
