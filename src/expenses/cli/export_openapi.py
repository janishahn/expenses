import argparse
import json
from pathlib import Path


DEFAULT_OUTPUT = Path("ios/ExpensesApp/Contract/openapi.json")


def export_openapi(output_path: Path = DEFAULT_OUTPUT) -> Path:
    from expenses.app import app

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export the FastAPI OpenAPI schema used by the native iOS app."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output path, default: {DEFAULT_OUTPUT}",
    )
    args = parser.parse_args()

    output_path = export_openapi(args.output)
    print(f"Wrote OpenAPI schema to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
