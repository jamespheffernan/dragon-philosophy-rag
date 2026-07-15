'use client';

import { useState, useEffect } from 'react';
import { api, Conversation } from '@/lib/api';

interface ConversationSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function ConversationSidebar({
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  isOpen,
  onClose,
}: ConversationSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getConversations();
      setConversations(result.conversations);
    } catch (err) {
      setError('Failed to load conversations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = () => {
    onNewConversation();
    setDeleteConfirm(null);
  };

  const handleSelectConversation = (id: string) => {
    onSelectConversation(id);
    onClose();
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirm(null);
      if (activeConversationId === id) {
        onDeleteConversation(id);
      }
    } catch (err) {
      setError('Failed to delete conversation');
      console.error(err);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:static left-0 top-0 h-screen w-64 bg-zinc-900 dark:bg-zinc-950 border-r border-zinc-800 flex flex-col transition-transform duration-300 z-40 lg:z-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-white font-semibold">Conversations</h2>
          <button
            onClick={onClose}
            className="lg:hidden text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* New Chat Button */}
        <button
          onClick={handleNewConversation}
          className="mx-4 mt-4 mb-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition text-sm font-medium"
        >
          + New Chat
        </button>

        {/* Error Message */}
        {error && (
          <div className="mx-4 mb-4 p-2 bg-red-900/20 border border-red-800 text-red-200 text-xs rounded">
            {error}
          </div>
        )}

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-zinc-400 text-sm">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-zinc-400 text-sm">No conversations yet</div>
          ) : (
            <div className="space-y-2 p-4">
              {conversations.map((conv) => (
                <div key={conv.id}>
                  <button
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                      activeConversationId === conv.id
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    <p className="truncate font-medium">{conv.title}</p>
                    <p className="text-xs text-zinc-400 mt-1">{formatDate(conv.updated_at)}</p>
                  </button>

                  {/* Delete confirmation or button */}
                  {deleteConfirm === conv.id ? (
                    <div className="px-3 py-2 text-xs space-y-2">
                      <p className="text-zinc-300">Delete this conversation?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDeleteConversation(conv.id)}
                          className="flex-1 px-2 py-1 bg-red-900/50 hover:bg-red-800 text-red-100 rounded transition"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="flex-1 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white rounded transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(conv.id)}
                      className="w-full text-left px-3 py-1 text-xs text-zinc-400 hover:text-red-400 transition"
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 text-xs text-zinc-400">
          {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
        </div>
      </div>
    </>
  );
}
