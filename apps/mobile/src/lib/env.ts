import { z } from 'zod'

const EnvSchema = z.object({
  clerkPublishableKey: z
    .string()
    .startsWith('pk_', 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk pk_ key'),
  sanity: z.object({ projectId: z.string().min(1), dataset: z.string().min(1) }).nullable(),
})

// Expo only inlines EXPO_PUBLIC_* when accessed statically, so read each var by name.
const sanityProjectId = process.env.EXPO_PUBLIC_SANITY_PROJECT_ID
export const envResult = EnvSchema.safeParse({
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  sanity: sanityProjectId
    ? { projectId: sanityProjectId, dataset: process.env.EXPO_PUBLIC_SANITY_DATASET ?? 'production' }
    : null,
})
