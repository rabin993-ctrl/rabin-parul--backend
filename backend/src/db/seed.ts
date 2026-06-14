import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  accounts,
  notificationPreferences,
  userPrivacySettings,
  userProfiles,
} from "./schema.js";

const email = "demo@parul.local";
const normalizedEmail = email.toLowerCase();

try {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.normalizedEmail, normalizedEmail))
    .limit(1);

  if (existing) {
    console.log(`Seed account already exists: ${email}`);
  } else {
    const passwordHash = await argon2.hash("ParulDemo123!", {
      type: argon2.argon2id,
    });

    const account = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          email,
          normalizedEmail,
          passwordHash,
          onboardingStatus: "complete",
          contactVerifiedAt: new Date(),
        })
        .returning({ id: accounts.id });

      if (!created) {
        throw new Error("Seed account was not created");
      }

      await tx.insert(userProfiles).values({
        userId: created.id,
        displayName: "Parul Demo",
        handle: "paruldemo",
        normalizedHandle: "paruldemo",
        handleSetAt: new Date(),
      });
      await tx.insert(userPrivacySettings).values({ userId: created.id });
      await tx.insert(notificationPreferences).values({ userId: created.id });
      return created;
    });

    console.log(`Seeded ${email} (${account.id}) with password ParulDemo123!`);
  }
} finally {
  await pool.end();
}
