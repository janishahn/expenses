import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

// Build an actual legacy-format upload with Python's standard-library SQLite,
// without coupling the fixture to the current application's database schema.
export function legacySqliteUpload(title: string): Buffer {
  return execFileSync("uv", ["run", "python", "-c", `
import sqlite3
import sys

with sqlite3.connect(":memory:") as database:
    database.executescript("""
        CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
        CREATE TABLE transactions (
            id INTEGER PRIMARY KEY, amount TEXT, category TEXT, description TEXT,
            transaction_date TEXT, transaction_type TEXT
        );
        CREATE TABLE recurring_transactions (
            id INTEGER PRIMARY KEY, amount TEXT, category TEXT, description TEXT,
            start_date TEXT, recurrence_type TEXT, interval INTEGER,
            transaction_type TEXT, last_processed_date TEXT
        );
    """)
    database.execute(
        "INSERT INTO transactions VALUES (1, ?, ?, ?, ?, ?)",
        ("42.51", "Legacy Food", sys.argv[1], "2025-01-03 08:15:00", "expense"),
    )
    database.commit()
    sys.stdout.buffer.write(database.serialize())
`, title], { cwd: repoRoot })
}

export function readPortableExport(path: string): {
  format: string
  transactions: Array<{ title: string; amount_cents: number; type: string }>
} {
  const result = execFileSync("uv", ["run", "python", "-c", `
import json
import sys
from zipfile import ZipFile

with ZipFile(sys.argv[1]) as archive:
    manifest = json.loads(archive.read("manifest.json"))
    rows = archive.read(manifest["datasets"]["transactions"]["path"])
    print(json.dumps({
        "format": manifest["format"],
        "transactions": [json.loads(line) for line in rows.splitlines()],
    }))
`, path], { cwd: repoRoot, encoding: "utf8" })
  return JSON.parse(result)
}
