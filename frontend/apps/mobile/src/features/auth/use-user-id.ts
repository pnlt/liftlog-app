import { useAuth } from '@clerk/expo'

/** Clerk user id. Only call below the signed-in layout, which never renders without one. */
export function useUserId(): string {
  const { userId } = useAuth()
  if (!userId) throw new Error('useUserId called outside the signed-in tree')
  return userId
}
