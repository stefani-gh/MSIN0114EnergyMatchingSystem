"""Generate persistent matching runs used for visualisation testing."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from matching_model import UploadedFile, run_matching_engine


SERVER_DIR = Path(__file__).resolve().parent
DB_PATH = SERVER_DIR / "data" / "template-store.sqlite"
XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def seed_matching_test_results(
    consumption_path: Path,
    generation_path: Path,
) -> None:
    consumption_data = consumption_path.read_bytes()
    generation_data = generation_path.read_bytes()
    consumption_file = UploadedFile(consumption_path.name, consumption_data)
    generation_file = UploadedFile(generation_path.name, generation_data)
    approaches = [
        ("test-1-to-1-daily", "1-to-1 daily", "carry-forward"),
        ("test-1-to-1-hourly", "1-to-1 hourly", "carry-forward-hourly"),
        ("test-1-to-1-half-hourly", "1-to-1 half hourly", "non-carry-forward"),
    ]

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS matching_test_results (
                id TEXT PRIMARY KEY,
                display_order INTEGER NOT NULL,
                result_json TEXT NOT NULL,
                consumption_file_name TEXT NOT NULL,
                consumption_mime_type TEXT NOT NULL,
                consumption_file_data BLOB NOT NULL,
                generation_file_name TEXT NOT NULL,
                generation_mime_type TEXT NOT NULL,
                generation_file_data BLOB NOT NULL
            )
            """
        )

        for display_order, (result_id, title, approach) in enumerate(approaches):
            result = run_matching_engine(
                consumption_file,
                generation_file,
                matching_approach=approach,
            )
            result.update(
                {
                    "id": result_id,
                    "title": title,
                    "createdBy": "Test data",
                }
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO matching_test_results (
                    id, display_order, result_json,
                    consumption_file_name, consumption_mime_type,
                    consumption_file_data, generation_file_name,
                    generation_mime_type, generation_file_data
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result_id,
                    display_order,
                    json.dumps(result, separators=(",", ":")),
                    consumption_path.name,
                    XLSX_MIME_TYPE,
                    consumption_data,
                    generation_path.name,
                    XLSX_MIME_TYPE,
                    generation_data,
                ),
            )

        connection.commit()


if __name__ == "__main__":
    raise SystemExit(
        "Import seed_matching_test_results and provide explicit source paths."
    )
