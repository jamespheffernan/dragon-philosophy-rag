'use client';

import { useState, useEffect, useRef } from 'react';
import { api, Document, Author, errorMessage } from '@/lib/api';

export default function LibraryPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [authorNames, setAuthorNames] = useState<string[]>([]);
  const [authorsWithDetails, setAuthorsWithDetails] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [isMergeMode, setIsMergeMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<{ id: string; title: string; author: string } | null>(null);
  const [regeneratingAuthor, setRegeneratingAuthor] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [bulkAuthor, setBulkAuthor] = useState('');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [reindexingAll, setReindexingAll] = useState(false);
  const [validationResult, setValidationResult] = useState<{
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
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
    validateDocuments();
  }, []);

  const validateDocuments = async () => {
    try {
      setValidating(true);
      const result = await api.validateDocuments();
      setValidationResult(result);
    } catch (err: unknown) {
      console.error('Validation error:', err);
    } finally {
      setValidating(false);
    }
  };

  const handleReindexDocument = async (documentId: string) => {
    try {
      setReindexing(documentId);
      setError(null);
      const result = await api.reindexDocument(documentId);
      setSuccess(`Successfully re-indexed "${result.title || documentId}". Added ${result.chunks_added} chunks.`);
      await validateDocuments();
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Re-indexing failed'));
    } finally {
      setReindexing(null);
    }
  };

  const handleReindexAll = async () => {
    if (!validationResult || validationResult.missing_vectors === 0) return;

    if (!confirm(`Re-index ${validationResult.missing_vectors} document(s)? This may take a while.`)) return;

    try {
      setReindexingAll(true);
      setError(null);
      const result = await api.reindexAllDocuments();
      setSuccess(`Successfully re-indexed ${result.reindexed} of ${result.total} document(s).`);
      await validateDocuments();
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Re-indexing failed'));
    } finally {
      setReindexingAll(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [docResponse, authorsResponse] = await Promise.all([
        api.getDocuments(),
        api.getAuthors(),
      ]);
      setDocuments(docResponse.documents);
      setAuthorNames(docResponse.authors || []);
      setAuthorsWithDetails(authorsResponse.authors || []);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setError('No file selected');
      return;
    }

    if (isMergeMode && !uploadTitle.trim()) {
      setError('Please provide a title for the merged document.');
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const fileList = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    // Validation
    for (const file of fileList) {
      const fileName = file.name.toLowerCase();
      const hasValidExtension =
        fileName.endsWith('.pdf') ||
        fileName.endsWith('.epub') ||
        fileName.endsWith('.epub.zip') ||
        fileName.endsWith('.txt');

      if (!hasValidExtension) {
        const extension = file.name.split('.').pop() || '(no extension)';
        errors.push(`"${file.name}": unsupported extension .${extension}`);
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      setError(`No valid files found. ${errors.length > 0 ? `Errors: ${errors.join(', ')}` : ''}`);
      setUploading(false);
      e.target.value = '';
      return;
    }

    try {
      if (isMergeMode) {
        // Upload all valid files as a single batch
        const result = await api.uploadFile(
          validFiles,
          true,
          uploadTitle.trim(),
          uploadAuthor.trim() || undefined
        );
        setSuccess(`Successfully merged and uploaded "${result.title}" with ${result.chunks_added} chunks!`);
        setUploadTitle(''); // Reset title
        setUploadAuthor(''); // Reset author
      } else {
        // Upload individually (sequential to avoid overwhelming server)
        let successCount = 0;
        for (const file of validFiles) {
          try {
            await api.uploadFile(file);
            successCount++;
          } catch (err: unknown) {
            errors.push(`"${file.name}": ${errorMessage(err, 'Upload failed')}`);
          }
        }

        if (successCount > 0) {
          setSuccess(`Successfully uploaded ${successCount} file(s)!`);
        }
      }

      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = '';

      if (errors.length > 0) {
        // Append errors to existing error state if any, or set it
        // If we are in merge mode, the main try/catch handles the batch error.
        // If in individual mode, we collect errors here.
        if (!isMergeMode && errors.length > 0) {
           setError((prev) => prev ? `${prev}. Errors: ${errors.join(', ')}` : `Errors: ${errors.slice(0, 3).join(', ')}${errors.length > 3 ? '...' : ''}`);
        }
      }
    }
  };

  const handleDelete = async (documentId: string, label: string) => {
    if (!confirm(`Are you sure you want to delete "${label}"?`)) return;

    try {
      await api.deleteDocument(documentId);
      setSuccess('Document deleted successfully');
      setSelectedDocs((prev) => {
        const next = new Set(prev);
        next.delete(documentId);
        return next;
      });
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Delete failed'));
    }
  };

  const handleRegenerateAuthorStyleGuide = async (authorName: string) => {
    try {
      setRegeneratingAuthor(authorName);
      setError(null);
      const result = await api.regenerateAuthorStyleGuide(authorName);
      setSuccess(`Style guide regenerated for ${authorName} (sampled ${result.documents_sampled} documents)`);
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to regenerate style guide'));
    } finally {
      setRegeneratingAuthor(null);
    }
  };

  const startEditing = (doc: Document) => {
    setEditingDoc({
      id: doc.id,
      title: doc.title || '',
      author: doc.author || '',
    });
  };

  const cancelEditing = () => {
    setEditingDoc(null);
  };

  const handleEditChange = (field: 'title' | 'author', value: string) => {
    if (!editingDoc) return;
    setEditingDoc({ ...editingDoc, [field]: value });
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    if (!editingDoc.title.trim() && !editingDoc.author.trim()) {
      setError('Please provide at least a title or an author.');
      return;
    }

    try {
      setSavingEdit(true);
      setError(null);
      await api.updateDocument(editingDoc.id, {
        title: editingDoc.title.trim() || undefined,
        author: editingDoc.author.trim() || undefined,
      });
      setSuccess('Document metadata updated');
      setEditingDoc(null);
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Update failed'));
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedDocs.size === documents.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(documents.map((d) => d.id)));
    }
  };

  const handleBulkAuthorUpdate = async () => {
    if (selectedDocs.size === 0) {
      setError('Please select at least one document');
      return;
    }
    if (!bulkAuthor.trim()) {
      setError('Please enter an author name');
      return;
    }

    try {
      setBulkUpdating(true);
      setError(null);
      const result = await api.bulkUpdateAuthor(Array.from(selectedDocs), bulkAuthor.trim());
      setSuccess(`Updated ${result.updated_count} document(s) to author: ${result.author}`);
      setSelectedDocs(new Set());
      setBulkAuthor('');
      await loadData();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Bulk update failed'));
    } finally {
      setBulkUpdating(false);
    }
  };

  // Group documents by author for display
  const documentsByAuthor = documents.reduce((acc, doc) => {
    const author = doc.author || 'Unassigned';
    if (!acc[author]) acc[author] = [];
    acc[author].push(doc);
    return acc;
  }, {} as Record<string, Document[]>);

  const sortedAuthorGroups = Object.entries(documentsByAuthor).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b);
  });

  // Get style guide for an author
  const getAuthorStyleGuide = (authorName: string): string | null => {
    const author = authorsWithDetails.find((a) => a.name === authorName);
    return author?.style_guide || null;
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-8">
          Library
        </h1>

        {/* Validation Warning */}
        {validationResult && validationResult.missing_vectors > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                  ⚠️ Missing Vectors Detected
                </h3>
                <p className="text-yellow-700 dark:text-yellow-300 mb-3">
                  {validationResult.missing_vectors} document(s) are missing vectors and may not be searchable.
                  This can happen when switching between embedding modes or if the database was reset.
                </p>
                <ul className="list-disc list-inside text-sm text-yellow-700 dark:text-yellow-300 mb-3 space-y-1">
                  {validationResult.missing_documents.slice(0, 5).map((doc) => (
                    <li key={doc.id}>
                      {doc.title || doc.source || 'Unknown'}
                      {!doc.file_exists && ' (file not found - re-upload required)'}
                    </li>
                  ))}
                  {validationResult.missing_documents.length > 5 && (
                    <li>... and {validationResult.missing_documents.length - 5} more</li>
                  )}
                </ul>
                <div className="flex gap-2">
                  <button
                    onClick={handleReindexAll}
                    disabled={reindexingAll}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reindexingAll ? 'Re-indexing...' : `Re-index All (${validationResult.missing_vectors})`}
                  </button>
                  <button
                    onClick={validateDocuments}
                    disabled={validating}
                    className="px-4 py-2 bg-yellow-100 dark:bg-yellow-900/40 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 text-yellow-800 dark:text-yellow-200 rounded transition disabled:opacity-50"
                  >
                    {validating ? 'Validating...' : 'Refresh Status'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Section */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 mb-8">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Upload Document
          </h2>

          <div className="mb-4 space-y-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="merge-mode"
                checked={isMergeMode}
                onChange={(e) => setIsMergeMode(e.target.checked)}
                className="h-4 w-4 text-zinc-900 dark:text-zinc-50 border-zinc-300 dark:border-zinc-700 rounded"
              />
              <label htmlFor="merge-mode" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Merge selected files into a single document (e.g. chapters of a book)
              </label>
            </div>

            {isMergeMode && (
              <div className="flex gap-4 flex-wrap">
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Document Title (Required)"
                  className="flex-1 min-w-[200px] px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                />
                <input
                  type="text"
                  list="author-suggestions-upload"
                  value={uploadAuthor}
                  onChange={(e) => setUploadAuthor(e.target.value)}
                  placeholder="Author (Optional)"
                  className="flex-1 min-w-[200px] px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                />
                <datalist id="author-suggestions-upload">
                  {authorNames.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleButtonClick}
              disabled={uploading}
              className="px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Choose Files (PDF, EPUB, TXT)'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.epub,.epub.zip,.txt"
              multiple
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
            {uploading && (
              <span className="text-zinc-600 dark:text-zinc-400">Processing document...</span>
            )}
          </div>
        </div>

        {/* Bulk Author Assignment */}
        {documents.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 mb-8">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
              Assign Author to Multiple Documents
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Select documents below, then choose or enter an author name to assign them all at once.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <input
                  type="text"
                  list="author-suggestions"
                  value={bulkAuthor}
                  onChange={(e) => setBulkAuthor(e.target.value)}
                  placeholder="Enter or select author name..."
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                />
                <datalist id="author-suggestions">
                  {authorNames.map((author) => (
                    <option key={author} value={author} />
                  ))}
                </datalist>
              </div>
              <button
                onClick={handleBulkAuthorUpdate}
                disabled={bulkUpdating || selectedDocs.size === 0}
                className="px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkUpdating ? 'Updating...' : `Assign to ${selectedDocs.size} selected`}
              </button>
              <button
                onClick={selectAll}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition"
              >
                {selectedDocs.size === documents.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {/* Documents List - Grouped by Author */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Documents ({documents.length}) • {authorNames.length} Author{authorNames.length !== 1 ? 's' : ''}
            </h2>
          </div>
          {loading ? (
            <div className="p-6 text-center text-zinc-600 dark:text-zinc-400">
              Loading...
            </div>
          ) : documents.length === 0 ? (
            <div className="p-6 text-center text-zinc-600 dark:text-zinc-400">
              No documents yet. Upload a PDF or EPUB file to get started.
            </div>
          ) : (
            <div>
              {sortedAuthorGroups.map(([author, docs]) => {
                const styleGuide = author !== 'Unassigned' ? getAuthorStyleGuide(author) : null;
                const isRegenerating = regeneratingAuthor === author;

                return (
                  <div key={author} className="border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
                    {/* Author Header with Style Guide */}
                    <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-zinc-700 dark:text-zinc-300">
                          {author} ({docs.length} document{docs.length !== 1 ? 's' : ''})
                        </h3>
                        {author !== 'Unassigned' && (
                          <button
                            onClick={() => handleRegenerateAuthorStyleGuide(author)}
                            disabled={isRegenerating}
                            className="text-sm px-3 py-1 text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
                          >
                            {isRegenerating ? 'Regenerating...' : 'Regenerate Style Guide'}
                          </button>
                        )}
                      </div>
                      {styleGuide && (
                        <details className="mt-3">
                          <summary className="text-sm text-blue-600 dark:text-blue-400 cursor-pointer">
                            View {author}&apos;s style guide
                          </summary>
                          <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                            {styleGuide}
                          </div>
                        </details>
                      )}
                      {author !== 'Unassigned' && !styleGuide && (
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500 italic">
                          No style guide yet. Click &quot;Regenerate Style Guide&quot; to create one.
                        </p>
                      )}
                    </div>

                    {/* Documents under this author */}
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {docs.map((doc) => {
                        const isEditing = editingDoc?.id === doc.id;
                        const isSelected = selectedDocs.has(doc.id);
                        const isMissingVectors = validationResult?.missing_documents.some(m => m.id === doc.id) || false;
                        const isReindexing = reindexing === doc.id;
                        return (
                          <div key={doc.id} className={`p-6 flex justify-between items-start gap-4 flex-wrap ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                            <div className="flex items-start gap-4">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDocSelection(doc.id)}
                                className="mt-1.5 h-4 w-4 text-zinc-900 dark:text-zinc-50 border-zinc-300 dark:border-zinc-700 rounded"
                              />
                              <div>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={editingDoc?.title || ''}
                                      onChange={(e) => handleEditChange('title', e.target.value)}
                                      placeholder="Title"
                                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                                    />
                                    <input
                                      type="text"
                                      list="author-suggestions-edit"
                                      value={editingDoc?.author || ''}
                                      onChange={(e) => handleEditChange('author', e.target.value)}
                                      placeholder="Author"
                                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                                    />
                                    <datalist id="author-suggestions-edit">
                                      {authorNames.map((a) => (
                                        <option key={a} value={a} />
                                      ))}
                                    </datalist>
                                  </div>
                                ) : (
                                  <>
                                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                                      {doc.title || doc.source}
                                    </h3>
                                    {doc.author && (
                                      <p className="text-zinc-600 dark:text-zinc-400 mt-1">
                                        by {doc.author}
                                      </p>
                                    )}
                                  </>
                                )}
                                <p className="text-sm text-zinc-500 dark:text-zinc-500 mt-2">
                                  Source: {doc.source} • Type: {doc.file_type?.toUpperCase() || 'Unknown'}
                                </p>
                                {doc.created_at && (
                                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                                    Added: {new Date(doc.created_at).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    onClick={handleSaveEdit}
                                    disabled={savingEdit}
                                    className="px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition disabled:opacity-50"
                                  >
                                    {savingEdit ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={cancelEditing}
                                    className="px-4 py-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => startEditing(doc)}
                                    className="px-4 py-2 text-zinc-900 dark:text-zinc-50 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
                                  >
                                    Edit
                                  </button>
                                  {isMissingVectors && (
                                    <button
                                      onClick={() => handleReindexDocument(doc.id)}
                                      disabled={isReindexing}
                                      className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Re-index this document to restore searchability"
                                    >
                                      {isReindexing ? 'Re-indexing...' : 'Re-index'}
                                    </button>
                                  )}
                                </>
                              )}
                              <button
                                onClick={() => handleDelete(doc.id, doc.title || doc.source)}
                                className="px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
