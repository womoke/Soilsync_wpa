import os
from pathlib import Path


def load_env_file() -> None:
    """Load key-value pairs from workspace or backend .env files into os.environ."""
    env_paths = (
        Path(__file__).resolve().parents[2] / ".env",
        Path(__file__).resolve().parents[1] / ".env",
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
    )
    for env_path in env_paths:
        if not env_path.is_file():
            continue
        try:
            content = env_path.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            normalized_key = key.strip()
            normalized_value = value.strip().strip("\"'")
            os.environ.setdefault(normalized_key, normalized_value)


load_env_file()
