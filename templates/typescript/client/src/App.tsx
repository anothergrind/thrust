import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function App() {
  const [health, setHealth] = useState<string>("checking...");

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((res) => res.json())
      .then((data) => setHealth(data.status))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          🚀 __PROJECT_NAME__
        </h1>
        <p className="text-lg text-gray-400">
          Your full-stack app is ready. Start building!
        </p>
        <div className="inline-flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              health === "ok"
                ? "bg-green-400"
                : health === "error"
                  ? "bg-red-400"
                  : "bg-yellow-400 animate-pulse"
            }`}
          />
          API: {health}
        </div>
      </div>
    </div>
  );
}
