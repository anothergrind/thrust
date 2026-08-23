<script setup lang="ts">
import { onMounted, ref } from "vue";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const health = ref("checking...");

onMounted(async () => {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    const data = await response.json();
    health.value = data.status;
  } catch {
    health.value = "error";
  }
});
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-white flex items-center justify-center">
    <div class="text-center space-y-6">
      <h1 class="text-5xl font-bold tracking-tight">🚀 __PROJECT_NAME__</h1>
      <p class="text-lg text-gray-400">Your full-stack app is ready. Start building!</p>
      <div class="inline-flex items-center gap-2 rounded-full bg-gray-800 px-4 py-2 text-sm">
        <span
          class="h-2 w-2 rounded-full"
          :class="{
            'bg-green-400': health === 'ok',
            'bg-red-400': health === 'error',
            'bg-yellow-400 animate-pulse': health !== 'ok' && health !== 'error',
          }"
        />
        API: {{ health }}
      </div>
    </div>
  </div>
</template>
