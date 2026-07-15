'use client';

import { useState, useEffect } from 'react';
import { api, AnalyzeResponse, Author, errorMessage } from '@/lib/api';
import { ContextDrawer, ContextReference } from '@/components/ContextDrawer';

export default function AnalyzePage() {
  const [situation, setSituation] = useState('');
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextRef, setContextRef] = useState<ContextReference | null>(null);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [selectedAuthor, setSelectedAuthor] = useState<string>('');

  useEffect(() => {
    loadAuthors();
  }, []);

  const loadAuthors = async () => {
    try {
      const response = await api.getAuthors();
      setAuthors(response.authors);
    } catch (err) {
      console.error('Failed to load authors:', err);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!situation.trim() || loading) return;

    try {
      setLoading(true);
      setError(null);
      setAnalysis(null);
      const response = await api.analyze(situation, 10, selectedAuthor || undefined);
      setAnalysis(response);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Analysis failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionClick = (question: string) => {
    setSituation(question);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Analyze Situation
          </h1>

          {/* Author Selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-600 dark:text-zinc-400">
              Advisor:
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

        <p className="text-zinc-600 dark:text-zinc-400 mb-8">
          Describe a situation or problem, and get relevant philosophical insights with follow-up questions.
          {selectedAuthor && (
            <span className="block mt-2 text-blue-600 dark:text-blue-400">
              Analysis will be provided from {selectedAuthor}&apos;s perspective.
            </span>
          )}
        </p>

        {/* Input Form */}
        <form onSubmit={handleAnalyze} className="mb-8">
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder={selectedAuthor
              ? `Describe your situation to ${selectedAuthor}...`
              : "Describe your situation... (e.g., 'I lost my job and feel aimless')"}
            rows={6}
            className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500 mb-4"
          />
          <button
            type="submit"
            disabled={loading || !situation.trim()}
            className="px-6 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </form>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Analysis Results */}
        {analysis && (
          <div className="space-y-6">
            {/* Analysis */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
                Analysis
                {analysis.author && (
                  <span className="text-sm font-normal text-blue-600 dark:text-blue-400 ml-2">
                    (from {analysis.author}&apos;s perspective)
                  </span>
                )}
              </h2>
              <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                {analysis.analysis}
              </p>
            </div>

            {/* Topics */}
            {analysis.topics.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
                  Key Topics
                </h2>
                <div className="flex flex-wrap gap-2">
                  {analysis.topics.map((topic, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 rounded-full text-sm"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-up Questions */}
            {analysis.follow_up_questions.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
                  Follow-up Questions
                </h2>
                <ul className="space-y-2">
                  {analysis.follow_up_questions.map((question, idx) => (
                    <li key={idx}>
                      <button
                        onClick={() => handleQuestionClick(question)}
                        className="text-left w-full px-4 py-2 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded transition text-zinc-900 dark:text-zinc-50"
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sources */}
            {analysis.sources.length > 0 && (
              <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
                  Relevant Sources
                </h2>
                <div className="space-y-4">
                  {analysis.sources.map((source, idx) => {
                    const canExpand =
                      typeof source.chunk_index === 'number' && Boolean(source.document_id);
                    return (
                      <div key={idx} className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                              {source.title}
                            </h3>
                            {source.author && (
                              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                                by {source.author}
                              </p>
                            )}
                          </div>
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
                              className="text-sm px-3 py-1 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                            >
                              Read context
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-2">
                          {source.text}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                          Relevance: {(source.score * 100).toFixed(1)}%
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <ContextDrawer reference={contextRef} onClose={() => setContextRef(null)} />
      </main>
    </div>
  );
}
