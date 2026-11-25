import { executeDbQuery, db } from './index.ts';
import { users } from './schema.ts';

/**
 * Concurrent-safe Firebase user synchronization into Cloud SQL.
 */
export async function getOrCreateUser(uid: string, email: string) {
  return executeDbQuery(async () => {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        role: 'employee',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  }, 'Unable to synchronize user account.');
}
