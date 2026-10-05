import os
from pathlib import Path


def _load_env_paths(env_paths: tuple[Path, ...]) -> None:
    for env_path in env_paths:
        if not env_path.is_file():
            continue
        try:
            content = env_path.read_text(encoding="utf-8")
        except OSError:
            continue
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def load_env_file() -> None:
    """Load local overrides before default workspace or backend environment files."""
    workspace = Path(__file__).resolve().parents[2]
    backend = Path(__file__).resolve().parents[1]
    cwd = Path.cwd()
    env_paths = (
        workspace / ".env.local",
        workspace / ".env",
        backend / ".env.local",
        backend / ".env",
        cwd / ".env.local",
        cwd / ".env",
        cwd.parent / ".env.local",
        cwd.parent / ".env",
    )
    _load_env_paths(env_paths)


load_env_file()
