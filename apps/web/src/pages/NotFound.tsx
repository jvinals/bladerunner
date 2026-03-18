import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
      <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
        <span className="text-2xl text-gray-300">404</span>
      </div>
      <h1 className="text-lg font-semibold text-gray-700 mb-2">Page not found</h1>
      <p className="text-sm text-gray-400 mb-6 text-center max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors"
      >
        <Home size={14} />
        Back to Home
      </Link>
    </div>
  );
}
