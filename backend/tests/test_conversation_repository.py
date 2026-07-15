import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.conversation_repository import ConversationRepository  # noqa: E402


def test_update_conversation_uses_only_supported_fields(tmp_path):
    repository = ConversationRepository(db_path=str(tmp_path / "conversations.db"))
    created = repository.create_conversation("conversation-1", "Original", "Plato")

    updated = repository.update_conversation("conversation-1", title="Revised")

    assert updated["title"] == "Revised"
    assert updated["author"] == "Plato"
    assert updated["updated_at"] >= created["updated_at"]
