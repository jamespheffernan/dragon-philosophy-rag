const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface ChunkMetadata {
  chunk_index?: number;
  document_id?: string;
  [key: string]: unknown;
}

export interface Document {
  id: string;
  source: string;
  title?: string | null;
  author?: string | null;
  file_type?: string | null;
  chunk_count?: number;
  style_guide?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SearchResult {
  text: string;
  source: string;
  title: string;
  author?: string;
  score: number;
  metadata: ChunkMetadata;
}

export interface ChatResponse {
  answer: string;
  sources: Array<{
    text: string;
    source: string;
    title: string;
    author?: string;
    score: number;
    chunk_index?: number;
    total_chunks?: number;
    document_id?: string;
  }>;
  author?: string | null;
}

export interface AnalyzeResponse {
  analysis: string;
  topics: string[];
  sources: Array<{
    text: string;
    source: string;
    title: string;
    author?: string;
    score: number;
    chunk_index?: number;
    total_chunks?: number;
    document_id?: string;
  }>;
  follow_up_questions: string[];
  author?: string | null;
}

export interface Author {
  name: string;
  style_guide?: string | null;
  document_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentContextResponse {
  document: Document;
  chunks: Array<{
    id: string;
    text: string;
    metadata: ChunkMetadata;
  }>;
  total_chunks: number;
  requested_chunk_index: number;
  window: number;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    text: string;
    source: string;
    title: string;
    author?: string;
    score: number;
    chunk_index?: number;
    total_chunks?: number;
    document_id?: string;
  }>;
  author?: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  author?: string | null;
  messages?: ConversationMessage[];
  created_at: string;
  updated_at: string;
}

export interface UploadResult {
  success: boolean;
  document_id: string;
  chunks_added: number;
  title: string;
  author?: string | null;
  file_type: string;
}

export const api = {
  async uploadFile(files: File | File[], merge: boolean = false, title?: string, author?: string): Promise<UploadResult> {
    const formData = new FormData();

    if (Array.isArray(files)) {
      files.forEach((file) => formData.append('files', file));
    } else {
      formData.append('files', files);
    }

    // Add query params
    const url = new URL(`${API_BASE_URL}/upload`);
    if (merge) url.searchParams.set('merge', 'true');
    if (title) url.searchParams.set('title', title);
    if (author) url.searchParams.set('author', author);

    const response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Upload failed');
    }

    return response.json();
  },

  async search(query: string, nResults: number = 5): Promise<{ query: string; results: SearchResult[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, n_results: nResults }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Search failed');
    }

    return response.json();
  },

  async chat(question: string, nContext: number = 5, author?: string): Promise<ChatResponse> {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, n_context: nContext, author: author || null }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Chat failed');
    }

    return response.json();
  },

  chatStream(
    question: string,
    nContext: number = 5,
    author?: string,
    history: Array<{ role: string; content: string }> = [],
    onToken: (token: string) => void = () => {},
    onSources: (sources: ChatResponse['sources'], author?: string | null) => void = () => {},
    onDone: () => void = () => {},
    onError: (error: string) => void = () => {},
  ): { abort: () => void } {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        n_context: nContext,
        author: author || null,
        history: history.length > 0 ? history : null,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const error = await response.json();
          onError(error.detail || 'Chat failed');
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onError('No response body');
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'token') {
                  onToken(data.content);
                } else if (data.type === 'sources') {
                  onSources(data.sources, data.author);
                } else if (data.type === 'done') {
                  onDone();
                } else if (data.type === 'error') {
                  onError(data.content);
                }
              } catch {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onError(err.message || 'Stream failed');
        }
      });

    return { abort: () => controller.abort() };
  },

  async analyze(situation: string, nContext: number = 10, author?: string): Promise<AnalyzeResponse> {
    const response = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ situation, n_context: nContext, author: author || null }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Analysis failed');
    }

    return response.json();
  },

  async getDocuments(): Promise<{ documents: Document[]; count: number; authors: string[] }> {
    const response = await fetch(`${API_BASE_URL}/documents`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch documents');
    }

    return response.json();
  },

  async getAuthors(): Promise<{ authors: Author[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/authors`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch authors');
    }

    return response.json();
  },

  async regenerateAuthorStyleGuide(authorName: string): Promise<{ author: string; style_guide: string; documents_sampled: number }> {
    const response = await fetch(`${API_BASE_URL}/authors/${encodeURIComponent(authorName)}/regenerate-style-guide`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to regenerate author style guide');
    }

    return response.json();
  },

  async bulkUpdateAuthor(documentIds: string[], author: string): Promise<{ updated_count: number; author: string }> {
    const response = await fetch(`${API_BASE_URL}/documents/bulk-update-author`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_ids: documentIds, author }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Bulk update failed');
    }

    return response.json();
  },

  async updateDocument(documentId: string, payload: { title?: string; author?: string }): Promise<{ document: Document }> {
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Update failed');
    }

    return response.json();
  },

  async getDocumentContext(documentId: string, chunkIndex: number, window: number = 1): Promise<DocumentContextResponse> {
    const url = new URL(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/context`);
    url.searchParams.set('chunk_index', chunkIndex.toString());
    url.searchParams.set('window', window.toString());

    const response = await fetch(url.toString());
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch context');
    }

    return response.json();
  },

  async deleteDocument(documentId: string): Promise<{ success: boolean; chunks_deleted: number }> {
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Delete failed');
    }

    return response.json();
  },

  async regenerateStyleGuide(documentId: string): Promise<{ style_guide: string; document: Document }> {
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/regenerate-style-guide`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to regenerate style guide');
    }

    return response.json();
  },

  async validateDocuments(): Promise<{
    total_documents: number;
    documents_with_vectors: number;
    missing_vectors: number;
    missing_documents: Array<{
      id: string;
      title?: string | null;
      source?: string | null;
      file_path?: string | null;
      file_exists: boolean;
    }>;
  }> {
    const response = await fetch(`${API_BASE_URL}/documents/validate`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Validation failed');
    }

    return response.json();
  },

  async reindexDocument(documentId: string): Promise<{ success: boolean; document_id: string; chunks_added: number; title?: string | null }> {
    const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/reindex`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Re-indexing failed');
    }

    return response.json();
  },

  async reindexAllDocuments(): Promise<{
    success: boolean;
    message?: string;
    reindexed: number;
    total: number;
    results: Array<{
      document_id: string;
      title?: string | null;
      status: 'success' | 'error';
      chunks_added?: number;
      error?: string;
    }>;
  }> {
    const response = await fetch(`${API_BASE_URL}/documents/reindex-all`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Re-indexing failed');
    }

    return response.json();
  },

  // Conversation persistence methods
  async getConversations(): Promise<{ conversations: Conversation[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/conversations`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch conversations');
    }

    return response.json();
  },

  async createConversation(title: string, author?: string): Promise<Conversation> {
    const response = await fetch(`${API_BASE_URL}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, author: author || null }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create conversation');
    }

    return response.json();
  },

  async getConversation(conversationId: string): Promise<Conversation> {
    const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to fetch conversation');
    }

    return response.json();
  },

  async updateConversation(
    conversationId: string,
    payload: { title?: string; author?: string }
  ): Promise<Conversation> {
    const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to update conversation');
    }

    return response.json();
  },

  async deleteConversation(conversationId: string): Promise<{ success: boolean }> {
    const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to delete conversation');
    }

    return response.json();
  },

  async addMessages(
    conversationId: string,
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      sources?: ChatResponse['sources'];
      author?: string | null;
    }>
  ): Promise<{ messages: ConversationMessage[]; count: number }> {
    const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources || null,
          author: m.author || null,
        })),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to add messages');
    }

    return response.json();
  },
};
