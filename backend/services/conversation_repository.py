import os
import sqlite3
from datetime import datetime, timezone
from threading import Lock
from typing import Dict, List, Optional
import json

from config import settings


class ConversationRepository:
    """SQLite-backed store for chat conversation persistence."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or settings.metadata_db_path
        # Ensure parent directory exists before connecting
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        self._lock = Lock()
        self._initialize_db()

    def _initialize_db(self):
        with self._get_connection() as conn:
            # Conversations table
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    author TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            # Messages table
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    sources TEXT,
                    author TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
    def _row_to_dict(row: sqlite3.Row) -> Dict:
        if not row:
            return {}
        return {key: row[key] for key in row.keys()}

    def create_conversation(
        self,
        conversation_id: str,
        title: str,
        author: Optional[str] = None,
    ) -> Dict:
        """Create a new conversation."""
        now = self._now_iso()
        with self._lock, self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO conversations (id, title, author, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (conversation_id, title, author, now, now),
            )
        return self.get_conversation(conversation_id)

    def get_conversation(self, conversation_id: str) -> Optional[Dict]:
        """Get a conversation with all its messages."""
        with self._get_connection() as conn:
            conv_row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()

            if not conv_row:
                return None

            # Get all messages for this conversation
            messages_rows = conn.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
                (conversation_id,),
            ).fetchall()

        conversation = self._row_to_dict(conv_row)
        messages = []
        for msg_row in messages_rows:
            msg_dict = self._row_to_dict(msg_row)
            # Parse sources JSON if present
            if msg_dict.get('sources'):
                try:
                    msg_dict['sources'] = json.loads(msg_dict['sources'])
                except (json.JSONDecodeError, TypeError):
                    msg_dict['sources'] = []
            messages.append(msg_dict)

        conversation['messages'] = messages
        return conversation

    def list_conversations(self) -> List[Dict]:
        """List all conversations ordered by most recent first."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT id, title, author, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def update_conversation(
        self,
        conversation_id: str,
        title: Optional[str] = None,
        author: Optional[str] = None,
    ) -> Optional[Dict]:
        """Update conversation metadata."""
        if title is None and author is None:
            return self.get_conversation(conversation_id)

        with self._lock, self._get_connection() as conn:
            conn.execute(
                """
                UPDATE conversations
                SET title = COALESCE(?, title),
                    author = COALESCE(?, author),
                    updated_at = ?
                WHERE id = ?
                """,
                (title, author, self._now_iso(), conversation_id),
            )

        return self.get_conversation(conversation_id)

    def delete_conversation(self, conversation_id: str) -> int:
        """Delete a conversation and all its messages."""
        with self._lock, self._get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM conversations WHERE id = ?",
                (conversation_id,),
            )
            return cursor.rowcount

    def add_message(
        self,
        message_id: str,
        conversation_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict]] = None,
        author: Optional[str] = None,
    ) -> Dict:
        """Add a message to a conversation."""
        sources_json = None
        if sources:
            sources_json = json.dumps(sources)

        now = self._now_iso()
        with self._lock, self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO messages (id, conversation_id, role, content, sources, author, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (message_id, conversation_id, role, content, sources_json, author, now),
            )
            # Update conversation updated_at timestamp
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )

        # Return the message
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM messages WHERE id = ?",
                (message_id,),
            ).fetchone()

        if row:
            msg_dict = self._row_to_dict(row)
            if msg_dict.get('sources'):
                try:
                    msg_dict['sources'] = json.loads(msg_dict['sources'])
                except (json.JSONDecodeError, TypeError):
                    msg_dict['sources'] = []
            return msg_dict
        return {}
