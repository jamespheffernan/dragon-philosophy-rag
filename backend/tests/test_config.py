import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def test_cors_origins_are_explicit_and_trimmed(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    from config import Settings

    settings = Settings(cors_origins="http://localhost:3000, https://example.test")

    assert settings.get_cors_origins() == [
        "http://localhost:3000",
        "https://example.test",
    ]
