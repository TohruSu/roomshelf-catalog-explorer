import os
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from flask import Flask

from .catalog import api
from .cli import register_commands
from .db import make_engine
from .errors import register_error_handlers


def create_app(config: Mapping[str, Any] | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    default_database = Path(app.instance_path) / "catalog.sqlite3"
    app.config.from_mapping(
        DATABASE_URL=os.environ.get("ROOMSHELF_DATABASE_URL", f"sqlite:///{default_database}"),
        MAX_CONTENT_LENGTH=4096,
        DEBUG=False,
    )
    if config:
        app.config.update(config)
    app.extensions["roomshelf_engine"] = make_engine(app.config["DATABASE_URL"])
    app.register_blueprint(api)
    register_commands(app)
    register_error_handlers(app)

    @app.after_request
    def security_headers(response: Any) -> Any:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    return app
