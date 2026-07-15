import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class FakeEmbeddings:
    vectors = {
        "stoicism": [1.0, 0.0],
        "A Stoic passage": [1.0, 0.0],
        "An Epicurean passage": [0.0, 1.0],
    }

    def embed_query(self, text):
        return self.vectors[text]

    def embed_documents(self, texts):
        return [self.vectors[text] for text in texts]


def test_vector_store_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    from services.vector_store import VectorStore

    store = VectorStore(
        db_path=str(tmp_path / "vectors.db"),
        embeddings=FakeEmbeddings(),
    )
    chunks = [
        {
            "text": "A Stoic passage",
            "metadata": {"source": "stoic.txt", "title": "Stoicism"},
        },
        {
            "text": "An Epicurean passage",
            "metadata": {"source": "epicurean.txt", "title": "Epicureanism"},
        },
    ]

    assert store.add_documents(chunks, "doc-1") == 2
    assert store.count() == 2
    assert store.search("stoicism", n_results=1)[0]["text"] == "A Stoic passage"
    assert [chunk["metadata"]["chunk_index"] for chunk in store.get_context_window("doc-1", 0)] == [0, 1]

    assert store.update_metadata_for_document("doc-1", {"author": "Test Author"}) == 2
    assert {metadata["author"] for metadata in store.get_all_metadata()} == {"Test Author"}

    assert store.delete_document("doc-1") == 2
    assert store.count() == 0
