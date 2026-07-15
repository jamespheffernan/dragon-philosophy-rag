'use client';

import { useState } from 'react';
import { api, SearchResult, errorMessage } from '@/lib/api';
import { ContextDrawer, ContextReference } from '@/components/ContextDrawer';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextRef, setContextRef] = useState<ContextReference | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.search(query, 10);
      setResults(response.results);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Search failed'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
          Search
        </h1>

        {/* Search Form */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a term or concept..."
              className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Results ({results.length})
            </h2>
            {results.map((result, idx) => {
              const documentId = result.metadata?.document_id;
              const chunkIndex = result.metadata?.chunk_index;
              const canExpand =
                typeof chunkIndex === 'number' &&
                typeof documentId === 'string';
              return (
                <div
                  key={idx}
                  className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {result.title}
                      </h3>
                      {result.author && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                          by {result.author}
                        </p>
                      )}
                    </div>
                    <span className="text-sm text-zinc-500 dark:text-zinc-500">
                      {(result.score * 100).toFixed(1)}% match
                    </span>
                  </div>
                  <p className="text-zinc-700 dark:text-zinc-300 mt-3 whitespace-pre-wrap">
                    {result.text}
                  </p>
                  <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      Source: {result.source}
                    </p>
                    {canExpand && (
                      <button
                        onClick={() =>
                          setContextRef({
                            documentId,
                            chunkIndex,
                            title: result.title,
                            author: result.author,
                          })
                        }
                        className="text-sm text-zinc-900 dark:text-zinc-50 border border-zinc-300 dark:border-zinc-700 px-3 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                      >
                        Read more context
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && results.length === 0 && query && !error && (
          <div className="text-center text-zinc-600 dark:text-zinc-400 py-12">
            No results found. Try a different search term.
          </div>
        )}
        <ContextDrawer reference={contextRef} onClose={() => setContextRef(null)} />
      </main>
    </div>
  );
}
