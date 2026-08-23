<script lang="ts">
  import { onMount } from "svelte";
  import { env } from "$env/dynamic/public";

  const API_URL = env.PUBLIC_API_URL || "http://localhost:3001";

  let health = $state("checking...");

  onMount(async () => {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      health = data.status;
    } catch {
      health = "error";
    }
  });
</script>

<div class="min-h-screen bg-gray-950 text-white flex items-center justify-center">
  <div class="text-center space-y-6">
    <h1 class="text-5xl font-bold tracking-tight">🚀 __PROJECT_NAME__</h1>
    <p class="text-lg text-gray-400">Your full-stack app is ready. Start building!</p>
    <div class="inline-flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2 text-sm">
      <span
        class="h-2 w-2 rounded-full {health === 'ok'
          ? 'bg-green-400'
          : health === 'error'
            ? 'bg-red-400'
            : 'bg-yellow-400 animate-pulse'}"
      ></span>
      API: {health}
    </div>
  </div>
</div>
