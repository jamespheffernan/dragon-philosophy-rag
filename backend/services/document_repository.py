import os
import sqlite3
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional

from config import settings


class DocumentRepository:
    """Lightweight SQLite-backed store for document metadata."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or settings.metadata_db_path
        # Ensure parent directory exists before connecting
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        self._lock = Lock()
        self._initialize_db()

    def _initialize_db(self):
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    title TEXT,
                    author TEXT,
                    file_type TEXT,
                    chunk_count INTEGER DEFAULT 0,
                    style_guide TEXT,
                    file_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            # Add file_path column if it doesn't exist (migration for existing databases)
            try:
                conn.execute("ALTER TABLE documents ADD COLUMN file_path TEXT")
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass
            # Authors table for per-author style guides
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS authors (
                    name TEXT PRIMARY KEY,
                    style_guide TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Optional[str]]:
        if not row:
            return {}
        return {key: row[key] for key in row.keys()}

    def create_document(
        self,
        document_id: str,
        source: str,
        title: Optional[str],
        author: Optional[str],
        file_type: Optional[str],
        chunk_count: int,
        file_path: Optional[str] = None,
    ) -> Dict[str, Optional[str]]:
        """Insert a new document row."""
        now = self._now_iso()
        with self._lock, self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO documents (
                    id, source, title, author, file_type, chunk_count,
                    style_guide, file_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
                """,
                (
                    document_id,
                    source,
                    title,
                    author,
                    file_type,
                    chunk_count,
                    file_path,
                    now,
                    now,
                ),
            )
        return self.get_document(document_id)

    def update_document(
        self,
        document_id: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
        style_guide: Optional[str] = None,
        file_path: Optional[str] = None,
    ) -> Optional[Dict[str, Optional[str]]]:
        """Update mutable fields of a document."""
        if all(value is None for value in (title, author, style_guide, file_path)):
            return self.get_document(document_id)

        with self._lock, self._get_connection() as conn:
            conn.execute(
                """
                UPDATE documents
                SET title = COALESCE(?, title),
                    author = COALESCE(?, author),
                    style_guide = COALESCE(?, style_guide),
                    file_path = COALESCE(?, file_path),
                    updated_at = ?
                WHERE id = ?
                """,
                (title, author, style_guide, file_path, self._now_iso(), document_id),
            )

        return self.get_document(document_id)

    def get_document(self, document_id: str) -> Optional[Dict[str, Optional[str]]]:
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE id = ?",
                (document_id,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_documents(self) -> List[Dict[str, Optional[str]]]:
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM documents ORDER BY created_at DESC"
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def delete_document(self, document_id: str) -> int:
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM documents WHERE id = ?",
                (document_id,),
            )
            return cursor.rowcount

    def list_authors(self) -> List[str]:
        """Get a list of all unique authors in the database."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT DISTINCT author FROM documents WHERE author IS NOT NULL AND author != '' ORDER BY author"
            ).fetchall()
        return [row['author'] for row in rows]

    def get_documents_by_author(self, author: str) -> List[Dict[str, Optional[str]]]:
        """Get all documents by a specific author."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE author = ? ORDER BY title",
                (author,),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def bulk_update_author(
        self,
        document_ids: List[str],
        author: str,
    ) -> int:
        """Update the author for multiple documents at once."""
        if not document_ids:
            return 0

        now = self._now_iso()
        with self._lock, self._get_connection() as conn:
            before = conn.total_changes
            conn.executemany(
                "UPDATE documents SET author = ?, updated_at = ? WHERE id = ?",
                [(author, now, document_id) for document_id in document_ids],
            )
            return conn.total_changes - before

    # -------------------------------------------------------------------------
    # Author-level operations
    # -------------------------------------------------------------------------

    def get_author(self, name: str) -> Optional[Dict[str, Optional[str]]]:
        """Get author record by name."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM authors WHERE name = ?",
                (name,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def upsert_author(
        self,
        name: str,
        style_guide: Optional[str] = None,
    ) -> Dict[str, Optional[str]]:
        """Create or update an author record."""
        now = self._now_iso()
        with self._lock, self._get_connection() as conn:
            existing = conn.execute(
                "SELECT * FROM authors WHERE name = ?", (name,)
            ).fetchone()
            if existing:
                if style_guide is not None:
                    conn.execute(
                        "UPDATE authors SET style_guide = ?, updated_at = ? WHERE name = ?",
                        (style_guide, now, name),
                    )
            else:
                conn.execute(
                    "INSERT INTO authors (name, style_guide, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (name, style_guide, now, now),
                )
        return self.get_author(name) or {}

    def list_authors_with_details(self) -> List[Dict[str, Optional[str]]]:
        """Get all authors with their style guides and document counts."""
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    a.name,
                    a.style_guide,
                    a.created_at,
                    a.updated_at,
                    COUNT(d.id) as document_count
                FROM authors a
                LEFT JOIN documents d ON d.author = a.name
                GROUP BY a.name
                ORDER BY a.name
                """
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def get_author_style_guide(self, author: str) -> Optional[str]:
        """Get just the style guide for an author."""
        author_record = self.get_author(author)
        return author_record.get('style_guide') if author_record else None
