from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

from langchain_openai import OpenAIEmbeddings

from config import settings


class EmbeddingClient(Protocol):
    def embed_query(self, text: str) -> List[float]: ...

    def embed_documents(self, texts: List[str]) -> List[List[float]]: ...


class VectorStore:
    """A small SQLite-backed vector store for the single-user prototype."""

    _embedding_cache: Dict[str, List[float]] = {}
    _cache_max_size = 1000

    def __init__(
        self,
        db_path: Optional[str] = None,
        embeddings: Optional[EmbeddingClient] = None,
    ):
        self.db_path = db_path or settings.vector_db_path
        Path(self.db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
        self.embeddings = embeddings or OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model="text-embedding-3-small",
        )
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS vector_chunks (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    embedding_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_vector_chunks_document_id
                ON vector_chunks(document_id)
                """
            )

    def _get_cached_embedding(self, text: str) -> List[float]:
        cache_key = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if cache_key in self._embedding_cache:
            return self._embedding_cache[cache_key]

        embedding = self.embeddings.embed_query(text)
        if len(self._embedding_cache) >= self._cache_max_size:
            oldest_key = next(iter(self._embedding_cache))
            del self._embedding_cache[oldest_key]
        self._embedding_cache[cache_key] = embedding
        return embedding

    def add_documents(self, chunks: List[Dict[str, Any]], document_id: str) -> int:
        texts = [str(chunk["text"]) for chunk in chunks]
        embedding_vectors = self.embeddings.embed_documents(texts)
        if len(embedding_vectors) != len(chunks):
            raise ValueError("Embedding provider returned an unexpected vector count")

        rows = []
        for index, (chunk, text, embedding) in enumerate(
            zip(chunks, texts, embedding_vectors, strict=True)
        ):
            metadata = self._clean_metadata(chunk.get("metadata", {}) or {})
            metadata["document_id"] = document_id
            metadata.setdefault("chunk_index", index)
            rows.append(
                (
                    f"{document_id}_chunk_{index}",
                    document_id,
                    text,
                    json.dumps(metadata, sort_keys=True),
                    json.dumps(embedding),
                )
            )

        with self._connect() as connection:
            connection.executemany(
                """
                INSERT OR REPLACE INTO vector_chunks
                    (id, document_id, text, metadata_json, embedding_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )
        return len(rows)

    def search(self, query: str, n_results: int = 5) -> List[Dict[str, Any]]:
        if n_results <= 0:
            return []

        query_embedding = self._get_cached_embedding(query)
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT text, metadata_json, embedding_json FROM vector_chunks"
            ).fetchall()

        scored_results = []
        for row in rows:
            embedding = json.loads(row["embedding_json"])
            scored_results.append(
                {
                    "text": row["text"],
                    "metadata": json.loads(row["metadata_json"]),
                    "score": self._cosine_similarity(query_embedding, embedding),
                }
            )

        scored_results.sort(key=lambda result: result["score"], reverse=True)
        return scored_results[:n_results]

    def get_all_documents(self) -> List[Dict[str, Any]]:
        unique_documents: Dict[str, Dict[str, Any]] = {}
        for metadata in self.get_all_metadata():
            source = str(metadata.get("source", "unknown"))
            unique_documents.setdefault(
                source,
                {
                    "source": source,
                    "title": metadata.get("title", source),
                    "author": metadata.get("author"),
                    "file_type": metadata.get("file_type"),
                },
            )
        return list(unique_documents.values())

    def update_metadata_for_document(
        self,
        document_id: str,
        updates: Dict[str, Any],
    ) -> int:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, metadata_json FROM vector_chunks WHERE document_id = ?",
                (document_id,),
            ).fetchall()
            for row in rows:
                metadata = json.loads(row["metadata_json"])
                metadata.update(updates)
                connection.execute(
                    "UPDATE vector_chunks SET metadata_json = ? WHERE id = ?",
                    (json.dumps(self._clean_metadata(metadata), sort_keys=True), row["id"]),
                )
        return len(rows)

    def delete_document(self, document_id: str) -> int:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM vector_chunks WHERE document_id = ?",
                (document_id,),
            )
        return cursor.rowcount

    def get_context_window(
        self,
        document_id: str,
        chunk_index: int,
        window: int = 1,
    ) -> List[Dict[str, Any]]:
        if chunk_index < 0:
            return []
        start = max(chunk_index - window, 0)
        end = chunk_index + window
        return self.get_document_chunks(document_id, list(range(start, end + 1)))

    def get_document_chunks(
        self,
        document_id: str,
        indices: Optional[List[int]] = None,
    ) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, text, metadata_json
                FROM vector_chunks
                WHERE document_id = ?
                """,
                (document_id,),
            ).fetchall()

        selected_indices = set(indices) if indices is not None else None
        chunks = []
        for row in rows:
            metadata = json.loads(row["metadata_json"])
            if selected_indices is not None and metadata.get("chunk_index") not in selected_indices:
                continue
            chunks.append(
                {
                    "id": row["id"],
                    "text": row["text"],
                    "metadata": metadata,
                }
            )
        chunks.sort(key=lambda chunk: chunk["metadata"].get("chunk_index", 0))
        return chunks

    def get_all_metadata(self) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT metadata_json FROM vector_chunks"
            ).fetchall()
        return [json.loads(row["metadata_json"]) for row in rows]

    def count(self) -> int:
        with self._connect() as connection:
            row = connection.execute("SELECT COUNT(*) AS count FROM vector_chunks").fetchone()
        return int(row["count"])

    @staticmethod
    def _cosine_similarity(left: List[float], right: List[float]) -> float:
        if len(left) != len(right):
            raise ValueError("Embedding vectors have different dimensions")
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return sum(a * b for a, b in zip(left, right, strict=True)) / (
            left_norm * right_norm
        )

    @staticmethod
    def _clean_metadata(metadata: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {}
        for key, value in metadata.items():
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                cleaned[key] = value
            else:
                cleaned[key] = str(value)
        return cleaned
