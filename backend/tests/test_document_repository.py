import sys
from pathlib import Path

import pytest

# Ensure backend package is importable when running from repo root
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.document_repository import DocumentRepository  # noqa: E402


@pytest.fixture()
def repo(tmp_path):
    db_path = tmp_path / "documents.db"
    return DocumentRepository(db_path=str(db_path))


def test_create_and_get_document(repo):
    doc_id = "doc-1"
    created = repo.create_document(
        document_id=doc_id,
        source="meditations.pdf",
        title="Meditations",
        author="Marcus Aurelius",
        file_type="pdf",
        chunk_count=42,
    )

    fetched = repo.get_document(doc_id)
    assert fetched is not None
    assert fetched["id"] == doc_id
    assert fetched["title"] == "Meditations"
    assert fetched["author"] == "Marcus Aurelius"
    assert fetched["chunk_count"] == 42
    assert fetched["style_guide"] is None
    assert created["created_at"] == created["updated_at"]


def test_update_document_fields(repo):
    doc_id = "doc-2"
    repo.create_document(
        document_id=doc_id,
        source="republic.epub",
        title="Republic",
        author="Plato",
        file_type="epub",
        chunk_count=10,
    )

    updated = repo.update_document(
        doc_id,
        title="The Republic",
        author="Plato (translated)",
        style_guide="- Speak in dialogues\n- Ask probing questions",
    )

    assert updated is not None
    assert updated["title"] == "The Republic"
    assert updated["author"] == "Plato (translated)"
    assert "- Speak in dialogues" in updated["style_guide"]
    assert updated["updated_at"] >= updated["created_at"]


def test_delete_document(repo):
    doc_id = "doc-3"
    repo.create_document(
        document_id=doc_id,
        source="ethics.pdf",
        title="Ethics",
        author="Spinoza",
        file_type="pdf",
        chunk_count=5,
    )

    deleted = repo.delete_document(doc_id)
    assert deleted == 1
    assert repo.get_document(doc_id) is None


def test_bulk_update_author(repo):
    for doc_id in ("doc-4", "doc-5"):
        repo.create_document(
            document_id=doc_id,
            source=f"{doc_id}.txt",
            title=doc_id,
            author=None,
            file_type="txt",
            chunk_count=1,
        )

    assert repo.bulk_update_author(["doc-4", "doc-5"], "Epictetus") == 2
    assert repo.get_document("doc-4")["author"] == "Epictetus"
    assert repo.get_document("doc-5")["author"] == "Epictetus"
