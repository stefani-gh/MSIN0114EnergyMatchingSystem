from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parent
DB_PATH = SERVER_DIR / "data" / "template-store.sqlite"
SPREADSHEET_MIME_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)
TEMPLATES = [
    {
        "id": "generation-template",
        "display_name": "Generation Template",
        "file_name": "Generation Template.xlsx",
        "source_path": SERVER_DIR / "source-templates" / "generation-template.xlsx",
    },
    {
        "id": "consumption-template",
        "display_name": "Consumption Template",
        "file_name": "Consumption Template.xlsx",
        "source_path": SERVER_DIR / "source-templates" / "consumption-template.xlsx",
    },
]


def seed_templates() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    updated_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")

    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS templates (
              id TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              file_name TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              file_data BLOB NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )

        for template in TEMPLATES:
            connection.execute(
                """
                INSERT INTO templates (
                  id,
                  display_name,
                  file_name,
                  mime_type,
                  file_data,
                  updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  display_name = excluded.display_name,
                  file_name = excluded.file_name,
                  mime_type = excluded.mime_type,
                  file_data = excluded.file_data,
                  updated_at = excluded.updated_at;
                """,
                (
                    template["id"],
                    template["display_name"],
                    template["file_name"],
                    SPREADSHEET_MIME_TYPE,
                    template["source_path"].read_bytes(),
                    updated_at,
                ),
            )

    names = ", ".join(template["display_name"] for template in TEMPLATES)
    print(f"Seeded {names} into {DB_PATH}")


if __name__ == "__main__":
    seed_templates()
