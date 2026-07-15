'use client';

import { useEffect, useState } from 'react';
import { api, DocumentContextResponse, errorMessage } from '@/lib/api';

export interface ContextReference {
  documentId: string;
  chunkIndex: number;
  title?: string | null;
  author?: string | null;
}

interface ContextDrawerProps {
  reference: ContextReference | null;
  onClose: () => void;
}

export function ContextDrawer({ reference, onClose }: ContextDrawerProps) {
  const [windowSize, setWindowSize] = useState(1);
  const [contextData, setContextData] = useState<DocumentContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const referenceDocumentId = reference?.documentId;
  const referenceChunkIndex = reference?.chunkIndex;

  useEffect(() => {
    if (!referenceDocumentId || referenceChunkIndex === undefined) {
      setContextData(null);
      setError(null);
      setWindowSize(1);
      setReloadKey(0);
      return;
    }
    setWindowSize(1);
    setReloadKey((prev) => prev + 1);
  }, [referenceDocumentId, referenceChunkIndex]);

  useEffect(() => {
    if (!reference) return;
    const fetchContext = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getDocumentContext(reference.documentId, reference.chunkIndex, windowSize);
        setContextData(data);
      } catch (err: unknown) {
        setError(errorMessage(err, 'Failed to load context'));
      } finally {
        setLoading(false);
      }
    };

    fetchContext();
  }, [reference, windowSize, reloadKey]);

  if (!reference) {
    return null;
  }

  const incrementWindow = () => {
    if (windowSize < 5) {
      setWindowSize((prev) => prev + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute right-0 top-0 h-full w-full sm:w-2/3 lg:w-1/2 bg-white dark:bg-zinc-900 shadow-xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {reference.title || 'Selected Passage'}
            </h2>
            {reference.author && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">by {reference.author}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loading && <p className="text-zinc-600 dark:text-zinc-300">Loading context...</p>}
          {error && (
            <div className="text-red-600 dark:text-red-400">
              <p>{error}</p>
              <button
                onClick={() => setReloadKey((prev) => prev + 1)}
                className="mt-2 text-sm underline"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && contextData?.chunks.length === 0 && (
            <p className="text-zinc-600 dark:text-zinc-300">No context available for this passage.</p>
          )}
          {contextData?.chunks.map((chunk) => (
            <div
              key={chunk.id}
              className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50"
            >
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                Chunk {(chunk.metadata?.chunk_index ?? 0) + 1} of{' '}
                {contextData?.total_chunks ?? '—'}
              </p>
              <p className="text-sm text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">
                {chunk.text}
              </p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Window size: {windowSize} • Chunk {reference.chunkIndex + 1}
          </p>
          <button
            onClick={incrementWindow}
            disabled={windowSize >= 5}
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded disabled:opacity-50"
          >
            {windowSize >= 5 ? 'Max window reached' : 'Load more context'}
          </button>
        </div>
      </div>
    </div>
  );
}
