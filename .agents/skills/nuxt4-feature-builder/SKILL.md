---
name: nuxt4-feature-builder
description: Builds frontend pages, components, composables, and type-safe API integrations in Nuxt 4 / Vue 3 for the "Vamos Aprendiendo Web" platform.
---

# Nuxt 4 Feature Builder

Use this skill when developing new pages, reusable components, or composables in the `frontend` folder of the project.

## Project Structure

```text
frontend/app/
├── components/          # Reusable Vue components
│   └── ui/              # Buttons, Cards, Modals, Inputs
├── composables/         # Custom reactive hooks (useAuth, useApi, etc.)
├── middleware/          # Route navigation guards (auth.ts)
├── pages/               # File-based routing pages
│   ├── index.vue
│   ├── login.vue
│   └── dashboard/
└── assets/              # Global styles, Tailwind/CSS, icons
```

## Standard Development Workflow

### 1. Reusable Composables (`composables/useApi.ts`)
Communicate with the backend `/api/v1` prefix with automatic auth headers:

```typescript
export const useApi = () => {
  const config = useRuntimeConfig();
  const token = useCookie('auth_token');

  const fetchApi = async <T>(endpoint: string, options: any = {}) => {
    return await $fetch<T>(`${config.public.apiBase || 'http://localhost:3000/api/v1'}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: token.value ? `Bearer ${token.value}` : '',
      },
    });
  };

  return { fetchApi };
};
```

### 2. Vue 3 `<script setup lang="ts">` Components
- Utilize TypeScript for props and emits.
- Keep UI components decoupled and presentation-focused.

```vue
<script setup lang="ts">
interface Props {
  title: string;
  count?: number;
}

const props = withDefaults(defineProps<Props>(), {
  count: 0
});

const emit = defineEmits<{
  (e: 'action', payload: string): void;
}>();
</script>

<template>
  <div class="card p-4 rounded-lg shadow bg-white">
    <h3 class="font-bold text-lg">{{ title }}</h3>
    <p class="text-gray-600">Total: {{ count }}</p>
    <button @click="emit('action', title)" class="btn btn-primary mt-2">
      Seleccionar
    </button>
  </div>
</template>
```

### 3. Route Pages (`pages/`)
- Use `definePageMeta` for middleware (`middleware: ['auth']`).
- Use `useAsyncData` or `useFetch` for SSR-friendly initial data loading.
