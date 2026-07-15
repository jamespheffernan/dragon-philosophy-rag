'use client';

import { useState, useEffect, useRef } from 'react';
import { api, ChatResponse, Author } from '@/lib/api';
import { ContextDrawer, ContextReference } from '@/components/ContextDrawer';
import ConversationSidebar from '@/components/ConversationSidebar';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatResponse['sources'];
  author?: string | null;
  isStreaming?: boolean;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextRef, setContextRef] = useState<ContextReference | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [selectedAuthor, setSelectedAuthor] = useState<string>('');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const abortRef = useRef<{ abort: () => void } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAuthors();
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadAuthors = async () => {
    try {
      const response = await api.getAuthors();
      setAuthors(response.authors);
    } catch (err) {
      console.error('Failed to load authors:', err);
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setActiveConversationId(null);
    setInput('');
    setError(null);
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const conversation = await api.getConversation(conversationId);
      setActiveConversationId(conversationId);
      setSelectedAuthor(conversation.author || '');

      // Convert stored messages to display format
      const displayMessages: Message[] = (conversation.messages || []).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        sources: msg.sources,
        author: msg.author,
        isStreaming: false,
      }));

      setMessages(displayMessages);
      setInput('');
      setError(null);
    } catch (err) {
      setError('Failed to load conversation');
      console.error(err);
    }
  };

  const generateConversationTitle = (firstMessage: string) => {
    return firstMessage.substring(0, 50).trim() + (firstMessage.length > 50 ? '...' : '');
  };

  const saveMessagesToConversation = async (conversationId: string, messagesToSave: Message[]) => {
    try {
      setIsSaving(true);
      await api.addMessages(
        conversationId,
        messagesToSave.map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources,
          author: m.author,
        }))
      );
    } catch (err) {
      console.error('Failed to save messages:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input };
    const question = input;
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    // Create conversation if this is the first message
    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const newConv = await api.createConversation(
          generateConversationTitle(question),
          selectedAuthor || undefined
        );
        conversationId = newConv.id;
        setActiveConversationId(conversationId);

        // Save the user message
        await saveMessagesToConversation(conversationId, [userMessage]);
      } catch {
        setError('Failed to create conversation');
        setLoading(false);
        return;
      }
    } else {
      // Save user message to existing conversation
      await saveMessagesToConversation(conversationId, [userMessage]);
    }

    // Build conversation history for context
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Add placeholder for streaming response
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '', isStreaming: true },
    ]);

    abortRef.current = api.chatStream(
      question,
      5,
      selectedAuthor || undefined,
      history,
      // onToken
      (token) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + token,
            };
          }
          return updated;
        });
      },
      // onSources
      (sources, author) => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = {
              ...lastMsg,
              sources,
              author,
            };
          }
          return updated;
        });
      },
      // onDone
      () => {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = {
              ...lastMsg,
              isStreaming: false,
            };
          }

          // Save assistant message to conversation
          if (conversationId && lastMsg && lastMsg.role === 'assistant') {
            saveMessagesToConversation(conversationId, [lastMsg]);
          }

          return updated;
        });
        setLoading(false);
        abortRef.current = null;
      },
      // onError
      (errorMsg) => {
        setError(errorMsg);
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
            updated[updated.length - 1] = {
              ...lastMsg,
              content: lastMsg.content || 'Sorry, I encountered an error.',
              isStreaming: false,
            };
          }
          return updated;
        });
        setLoading(false);
        abortRef.current = null;
      }
    );
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          updated[updated.length - 1] = {
            ...lastMsg,
            isStreaming: false,
          };
        }
        return updated;
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black flex">
      {/* Sidebar */}
      <ConversationSidebar
        activeConversationId={activeConversationId}
        onSelectConversation={loadConversation}
        onNewConversation={startNewConversation}
        onDeleteConversation={() => startNewConversation()}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12 flex flex-col h-screen">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition"
              >
                ☰
              </button>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
                Chat
              </h1>
            </div>

            {/* Author Selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-600 dark:text-zinc-400">
                Speaking as:
              </label>
              <select
                value={selectedAuthor}
                onChange={(e) => setSelectedAuthor(e.target.value)}
                className="px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500"
              >
                <option value="">Auto-detect from context</option>
                {authors.map((author) => (
                  <option key={author.name} value={author.name}>
                    {author.name}
                    {author.document_count ? ` (${author.document_count} texts)` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Selected Author Info */}
          {selectedAuthor && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 px-4 py-3 rounded mb-4">
              <p className="text-sm">
                <strong>Chatting with {selectedAuthor}</strong> — responses will be in their voice and style.
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {/* Saving indicator */}
          {isSaving && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 px-4 py-3 rounded mb-4 text-sm">
              Saving conversation...
            </div>
          )}

          {/* Messages */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 mb-4 flex-1 overflow-y-auto p-6">
            {messages.length === 0 ? (
              <div className="text-center text-zinc-600 dark:text-zinc-400 py-12">
                {selectedAuthor
                  ? `Ask ${selectedAuthor} a question to get started.`
                  : 'Ask a question about the philosophical texts to get started.'}
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        msg.role === 'user'
                          ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50'
                      }`}
                    >
                      {msg.role === 'assistant' && msg.author && (
                        <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2">
                          Speaking as {msg.author}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap">
                        {msg.content}
                        {msg.isStreaming && (
                          <span className="inline-block w-2 h-4 ml-1 bg-zinc-500 animate-pulse" />
                        )}
                      </p>
                      {msg.sources && msg.sources.length > 0 && !msg.isStreaming && (
                        <div className="mt-3 pt-3 border-t border-zinc-300 dark:border-zinc-600">
                          <p className="text-xs font-semibold mb-2">Sources:</p>
                          <div className="space-y-1">
                            {msg.sources.slice(0, 3).map((source, sidx) => {
                              const canExpand =
                                typeof source.chunk_index === 'number' && Boolean(source.document_id);
                              return (
                                <div
                                  key={sidx}
                                  className="text-xs opacity-75 flex items-center justify-between gap-2"
                                >
                                  <p>
                                    • {source.title}
                                    {source.author && ` by ${source.author}`}
                                  </p>
                                  {canExpand && (
                                    <button
                                      onClick={() =>
                                        setContextRef({
                                          documentId: source.document_id as string,
                                          chunkIndex: source.chunk_index as number,
                                          title: source.title,
                                          author: source.author,
                                        })
                                      }
                                      className="text-[11px] px-2 py-1 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                                    >
                                      Expand
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Form */}
          <form onSubmit={handleSubmit}>
            <div className="flex gap-4">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selectedAuthor ? `Ask ${selectedAuthor}...` : 'Ask a question...'}
                className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500"
                disabled={loading || isSaving}
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || isSaving}
                  className="px-6 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50"
                >
                  Send
                </button>
              )}
            </div>
          </form>
          <ContextDrawer reference={contextRef} onClose={() => setContextRef(null)} />
        </div>
      </main>
    </div>
  );
}
