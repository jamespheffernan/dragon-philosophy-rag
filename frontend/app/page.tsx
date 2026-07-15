import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            Welcome to Dragon
          </h1>
          <p className="text-xl text-zinc-600 dark:text-zinc-400 mb-8">
            Your AI-powered tool for exploring philosophical texts
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              Library
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              Upload and manage your philosophical texts (PDF, EPUB)
            </p>
            <Link
              href="/library"
              className="inline-block px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition"
            >
              Go to Library
            </Link>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              Search
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              Search for terms and find relevant sections by relevance
            </p>
            <Link
              href="/search"
              className="inline-block px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition"
            >
              Start Searching
            </Link>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              Chat
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              Ask questions and get answers based on the texts
            </p>
            <Link
              href="/chat"
              className="inline-block px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition"
            >
              Start Chatting
            </Link>
          </div>
        </div>

        <div className="mt-8 bg-white dark:bg-zinc-900 p-6 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
            Analyze Situation
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-4">
            Describe a situation and get relevant philosophical insights with follow-up questions
          </p>
          <Link
            href="/analyze"
            className="inline-block px-4 py-2 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition"
          >
            Analyze a Situation
          </Link>
        </div>
      </main>
    </div>
  );
}
