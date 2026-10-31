---
name: nuxt4-feature-builder
description: Builds frontend pages, components, composables, and type-safe API integrations in Nuxt 4 / Vue 3 / PrimeVue for the "Vamos Aprendiendo Web" platform.
---

# Nuxt 4 Feature Builder

Use this skill when developing pages, components, or composables in `frontend-vamos-aprendiendo/` (sibling folder of the backend). Read its `AGENTS.md` and `ARQUITECTURA.md` first.

## Project Structure

```text
frontend-vamos-aprendiendo/app/
├── components/   # ui/ (UiButton, UiCard, UiInput, UiModal), dashboard/, layout/, library/, panel/
├── composables/  # use*.ts — the only place that calls the backend
├── layouts/      # user-panel.vue
├── middleware/   # auth, guest, profile-access, assessment-gate
├── pages/        # file-based routing
├── plugins/api.ts  # $api client (Bearer + token refresh on 401)
├── utils/        # profile-routes.ts (profiles, ROUTES, SESSION_COOKIE_OPTIONS), etc.
└── assets/       # scss/main.scss, css/tokens.css, img/
```

## Workflow

### 1. Composable that calls the backend
Use the `$api` plugin (base URL `NUXT_PUBLIC_API_BASE`, default `http://localhost:3000/api/v1`; token handling is automatic):

```typescript
export const useItems = () => {
  const { $api } = useNuxtApp();
  const items = useState<Item[]>('items', () => []);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const fetchItems = async () => {
    loading.value = true;
    error.value = null;
    try {
      items.value = await $api<Item[]>('/items');
    } catch (err: any) {
      error.value = err.data?.message || 'Error al cargar los datos';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  return { items, loading, error, fetchItems };
};
```

### 2. Components
`<script setup lang="ts">` with typed props/emits (`withDefaults(defineProps<Props>(), …)`, `defineEmits<…>()`). Reuse `components/ui/*` and PrimeVue; style with `<style scoped lang="scss">` and the project variables.

### 3. Pages
```typescript
definePageMeta({
  middleware: 'profile-access',
  allowedProfiles: ['tutor', 'adulto'], // admin | profesor | tester | tutor | adulto
});
```
Never call `$fetch` directly in a page; use a composable. Navigate with `navigateTo()`.
