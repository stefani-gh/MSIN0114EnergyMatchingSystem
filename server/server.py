from __future__ import annotations

import base64
import json
import os
import sqlite3
import traceback
import uuid
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
SERVER_INSTANCE_ID = uuid.uuid4().hex
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

        if path == "/api/matching/test-results":
            self.handle_test_results()
            return

        if path == "/api/settings/calendar":
            self.handle_get_calendar()
            return

        if path == "/api/registry/customers":
            self.handle_get_customers()
            return

        template_id = TEMPLATE_ROUTES.get(path)

        if template_id:
            self.handle_template_download(template_id)
            return

        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def handle_test_results(self) -> None:
        if not DB_PATH.exists():
            self.send_json(HTTPStatus.OK, {"results": [], "databaseRecords": []})
            return

        with sqlite3.connect(DB_PATH) as connection:
            table_exists = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'matching_test_results'"
            ).fetchone()
            rows = (
                connection.execute(
                    """
                    SELECT id, result_json, consumption_file_name,
                           consumption_mime_type, consumption_file_data,
                           generation_file_name, generation_mime_type,
                           generation_file_data
                    FROM matching_test_results
                    ORDER BY display_order
                    """
                ).fetchall()
                if table_exists
                else []
            )

        results = []
        database_records = []

        for row in rows:
            result = json.loads(row[1])
            results.append(result)
            database_records.append(
                {
                    "id": row[0],
                    "resultId": row[0],
                    "title": result["title"],
                    "createdBy": result["createdBy"],
                    "createdAt": result["createdAt"],
                    "consumptionFileName": row[2],
                    "generationFileName": row[5],
                    "consumptionFile": build_stored_upload_file(row[2], row[3], row[4]),
                    "generationFile": build_stored_upload_file(row[5], row[6], row[7]),
                    "deletedFromResults": False,
                }
            )

        self.send_json(
            HTTPStatus.OK,
            {
                "results": results,
                "databaseRecords": database_records,
                "serverInstanceId": SERVER_INSTANCE_ID,
            },
        )

    def do_POST(self) -> None:
        path = urlparse(self.path).path

        try:
            if path == "/api/settings/calendar":
                self.handle_save_calendar()
                return

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

    def handle_get_calendar(self) -> None:
        with sqlite3.connect(DB_PATH) as connection:
            ensure_calendar_table(connection)
            rows = connection.execute(
                "SELECT id, settlement_date, day_type, status FROM settlement_calendar"
            ).fetchall()

        self.send_json(
            HTTPStatus.OK,
            {
                "entries": [
                    {
                        "id": row[0],
                        "date": row[1],
                        "dayType": row[2],
                        "status": row[3],
                    }
                    for row in rows
                ]
            },
        )

    def handle_get_customers(self) -> None:
        with sqlite3.connect(DB_PATH) as connection:
            ensure_customer_registry_table(connection)
            rows = connection.execute(
                """
                SELECT id, name, contract_id, contract_name, site_id, mpan,
                       contracted_share_percentage
                FROM customer_registry
                ORDER BY display_order
                """
            ).fetchall()

        self.send_json(
            HTTPStatus.OK,
            {
                "records": [
                    {
                        "id": row[0],
                        "name": row[1],
                        "contractId": row[2],
                        "contractName": row[3],
                        "siteId": row[4],
                        "mpan": row[5],
                        "contractedSharePercentage": row[6],
                    }
                    for row in rows
                ]
            },
        )

    def handle_save_calendar(self) -> None:
        payload = read_json_request(self)
        entries = payload.get("entries")

        if not isinstance(entries, list):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Calendar entries are required.")

        validated_entries = []
        for entry in entries:
            if not isinstance(entry, dict):
                raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid calendar entry.")
            if entry.get("dayType") not in {"46-period", "50-period"}:
                raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid calendar day type.")
            if entry.get("status") not in {"Active", "Inactive"}:
                raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid calendar status.")
            validated_entries.append(entry)

        with sqlite3.connect(DB_PATH) as connection:
            ensure_calendar_table(connection)
            connection.execute("DELETE FROM settlement_calendar")
            connection.executemany(
                """
                INSERT INTO settlement_calendar (id, settlement_date, day_type, status)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        str(entry.get("id", "")),
                        str(entry.get("date", "")),
                        entry["dayType"],
                        entry["status"],
                    )
                    for entry in validated_entries
                ],
            )
            connection.commit()

        self.send_json(HTTPStatus.OK, {"entries": validated_entries})

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

        settlement_calendar = fields.get("settlementCalendar", "[]")
        empty_cells = validate_energy_file_template(
            uploaded_file, upload_type, settlement_calendar
        )
        generation_sources = (
            get_generation_sources(uploaded_file, settlement_calendar)
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
            fields.get("settlementCalendar", "[]"),
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


def read_json_request(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    try:
        content_length = int(handler.headers.get("Content-Length", "0"))
        payload = json.loads(handler.rfile.read(content_length) or b"{}")
    except (ValueError, json.JSONDecodeError) as exc:
        raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid JSON request.") from exc

    if not isinstance(payload, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid JSON request.")
    return payload


def ensure_calendar_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS settlement_calendar (
            id TEXT PRIMARY KEY,
            settlement_date TEXT NOT NULL UNIQUE,
            day_type TEXT NOT NULL,
            status TEXT NOT NULL
        )
        """
    )


def ensure_customer_registry_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_registry (
            id TEXT PRIMARY KEY,
            display_order INTEGER NOT NULL,
            name TEXT NOT NULL,
            contract_id TEXT,
            contract_name TEXT,
            site_id TEXT NOT NULL,
            mpan TEXT NOT NULL,
            contracted_share_percentage REAL
        )
        """
    )


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


def build_stored_upload_file(
    file_name: str,
    mime_type: str,
    file_data: bytes,
) -> dict[str, Any]:
    encoded_data = base64.b64encode(file_data).decode("ascii")
    return {
        "fileName": file_name,
        "mimeType": mime_type,
        "dataUrl": f"data:{mime_type};base64,{encoded_data}",
        "lastModified": 0,
    }


def run_server() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), EnergyMatchingRequestHandler)
    print(f"Python template and matching API listening on http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
