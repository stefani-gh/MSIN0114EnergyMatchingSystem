from __future__ import annotations

import json
import os
import sqlite3
import traceback
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from matching_model import (
    MatchingModelError,
    UploadedFile,
    get_generation_sources,
    run_matching_engine,
    validate_energy_file_template,
)


SERVER_DIR = Path(__file__).resolve().parent
DB_PATH = SERVER_DIR / "data" / "template-store.sqlite"
PORT = int(os.environ.get("PORT", "5174"))
TEMPLATE_ROUTES = {
    "/api/templates/generation/download": "generation-template",
    "/api/templates/consumption/download": "consumption-template",
}


class ApiError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class EnergyMatchingRequestHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        template_id = TEMPLATE_ROUTES.get(path)

        if template_id:
            self.handle_template_download(template_id)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        try:
            if path == "/api/matching/validate":
                self.handle_validate_matching_file()
                return

            if path == "/api/matching/run":
                self.handle_run_matching_engine()
                return

            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        except ApiError as exc:
            self.send_json(exc.status_code, {"error": exc.message})
        except MatchingModelError as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception:
            traceback.print_exc()
            self.send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The matching engine could not process these files."},
            )

    def handle_template_download(self, template_id: str) -> None:
        template = get_template(template_id)

        if template is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Template not found"})
            return

        file_name, mime_type, file_data = template
        self.send_response(HTTPStatus.OK)
        self.send_cors_headers()
        self.send_header("Content-Type", mime_type)
        self.send_header(
            "Content-Disposition", f'attachment; filename="{file_name}"'
        )
        self.send_header("Content-Length", str(len(file_data)))
        self.end_headers()
        self.wfile.write(file_data)

    def handle_validate_matching_file(self) -> None:
        fields, files = parse_multipart_request(self)
        uploaded_file = files.get("file")
        upload_type = fields.get("uploadType", "")

        if uploaded_file is None:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Please upload a file.")

        empty_cells = validate_energy_file_template(uploaded_file, upload_type)
        generation_sources = (
            get_generation_sources(uploaded_file)
            if upload_type == "generation"
            else []
        )
        self.send_json(
            HTTPStatus.OK,
            {
                "error": "",
                "emptyCells": empty_cells,
                "generationSources": generation_sources,
            },
        )

    def handle_run_matching_engine(self) -> None:
        fields, files = parse_multipart_request(self)
        consumption_file = files.get("consumptionFile")
        generation_file = files.get("generationFile")

        if consumption_file is None or generation_file is None:
            raise ApiError(
                HTTPStatus.BAD_REQUEST,
                "Please upload both consumption and generation files.",
            )

        result = run_matching_engine(
            consumption_file,
            generation_file,
            fields.get("customerAllocations", "[]"),
            fields.get("generatorCommodityMappings", "[]"),
            fields.get("matchingApproach", "non-carry-forward"),
        )
        self.send_json(HTTPStatus.OK, result)

    def send_json(self, status_code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")


def parse_multipart_request(
    handler: BaseHTTPRequestHandler,
) -> tuple[dict[str, str], dict[str, UploadedFile]]:
    content_type = handler.headers.get("Content-Type", "")

    if not content_type.lower().startswith("multipart/form-data"):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Expected multipart form data.")

    try:
        content_length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid request body.") from exc

    body = handler.rfile.read(content_length)
    message = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode(
            "utf-8"
        )
        + body
    )

    if not message.is_multipart():
        raise ApiError(HTTPStatus.BAD_REQUEST, "Expected multipart form data.")

    fields: dict[str, str] = {}
    files: dict[str, UploadedFile] = {}

    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue

        name = part.get_param("name", header="content-disposition")

        if not name:
            continue

        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""

        if filename:
            files[name] = UploadedFile(filename=filename, content=payload)
        else:
            charset = part.get_content_charset() or "utf-8"
            fields[name] = payload.decode(charset, errors="replace")

    return fields, files


def get_template(template_id: str) -> tuple[str, str, bytes] | None:
    if not DB_PATH.exists():
        return None

    with sqlite3.connect(DB_PATH) as connection:
        row = connection.execute(
            """
            SELECT file_name, mime_type, file_data
            FROM templates
            WHERE id = ?
            """,
            (template_id,),
        ).fetchone()

    return row if row is None else (row[0], row[1], row[2])


def run_server() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), EnergyMatchingRequestHandler)
    print(f"Python template and matching API listening on http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
