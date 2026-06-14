import argon2 from "argon2";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import {
  accounts,
  auditEvents,
  notificationPreferences,
  outboxEvents,
  userPrivacySettings,
  userProfiles,
  userSessions,
} from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import {
  createAccessToken,
  createRefreshSecret,
  formatRefreshToken,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretsMatch,
} from "../../shared/tokens.js";

type SessionMetadata = {
  deviceName?: string | undefined;
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
};

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function refreshExpiry(): Date {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + config.REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}

async function issueTokenPair(
  userId: string,
  sessionId: string,
  refreshSecret: string,
): Promise<TokenPair> {
  return {
    accessToken: await createAccessToken(userId, sessionId),
    refreshToken: formatRefreshToken(sessionId, refreshSecret),
    accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
  requestId: string;
  session: SessionMetadata;
}): Promise<{
  account: {
    id: string;
    onboardingStatus: "username_required";
    nextStep: "username_required";
  };
  tokens: TokenPair;
}> {
  const email = normalizedEmail(input.email);
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const refreshSecret = createRefreshSecret();

  const created = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.normalizedEmail, email))
      .limit(1);

    if (existing) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account already uses this email address.",
      );
    }

    const [account] = await tx
      .insert(accounts)
      .values({
        email: input.email.trim(),
        normalizedEmail: email,
        passwordHash,
      })
      .returning({ id: accounts.id });

    if (!account) {
      throw new AppError(500, "ACCOUNT_CREATE_FAILED", "Account was not created.");
    }

    await tx.insert(userProfiles).values({
      userId: account.id,
      displayName: input.displayName.trim(),
    });
    await tx.insert(userPrivacySettings).values({ userId: account.id });
    await tx.insert(notificationPreferences).values({ userId: account.id });

    const [session] = await tx
      .insert(userSessions)
      .values({
        userId: account.id,
        refreshTokenHash: hashRefreshSecret(refreshSecret),
        expiresAt: refreshExpiry(),
        deviceName: input.session.deviceName,
        userAgent: input.session.userAgent,
        ipAddress: input.session.ipAddress,
      })
      .returning({ id: userSessions.id });

    if (!session) {
      throw new AppError(500, "SESSION_CREATE_FAILED", "Session was not created.");
    }

    await tx.insert(auditEvents).values({
      actorUserId: account.id,
      action: "account.created",
      targetType: "account",
      targetId: account.id,
      requestId: input.requestId,
    });
    await tx.insert(outboxEvents).values({
      aggregateType: "account",
      aggregateId: account.id,
      eventType: "account.created",
      payload: { accountId: account.id },
    });

    return { accountId: account.id, sessionId: session.id };
  });

  return {
    account: {
      id: created.accountId,
      onboardingStatus: "username_required",
      nextStep: "username_required",
    },
    tokens: await issueTokenPair(
      created.accountId,
      created.sessionId,
      refreshSecret,
    ),
  };
}

export async function login(input: {
  email: string;
  password: string;
  session: SessionMetadata;
}): Promise<{
  account: {
    id: string;
    onboardingStatus: "username_required" | "complete";
    nextStep: "username_required" | "app";
  };
  tokens: TokenPair;
}> {
  const [account] = await db
    .select({
      id: accounts.id,
      passwordHash: accounts.passwordHash,
      status: accounts.status,
      onboardingStatus: accounts.onboardingStatus,
    })
    .from(accounts)
    .where(eq(accounts.normalizedEmail, normalizedEmail(input.email)))
    .limit(1);

  const passwordMatches =
    account && (await argon2.verify(account.passwordHash, input.password));

  if (!account || !passwordMatches) {
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
  }

  if (account.status !== "active") {
    throw new AppError(
      403,
      "ACCOUNT_NOT_ACTIVE",
      "This account is not currently active.",
    );
  }

  const refreshSecret = createRefreshSecret();
  const [session] = await db
    .insert(userSessions)
    .values({
      userId: account.id,
      refreshTokenHash: hashRefreshSecret(refreshSecret),
      expiresAt: refreshExpiry(),
      deviceName: input.session.deviceName,
      userAgent: input.session.userAgent,
      ipAddress: input.session.ipAddress,
    })
    .returning({ id: userSessions.id });

  if (!session) {
    throw new AppError(500, "SESSION_CREATE_FAILED", "Session was not created.");
  }

  return {
    account: {
      id: account.id,
      onboardingStatus: account.onboardingStatus,
      nextStep:
        account.onboardingStatus === "complete" ? "app" : "username_required",
    },
    tokens: await issueTokenPair(account.id, session.id, refreshSecret),
  };
}

export async function rotateRefreshToken(
  refreshToken: string,
): Promise<TokenPair> {
  const parsed = parseRefreshToken(refreshToken);
  const [session] = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      refreshTokenHash: userSessions.refreshTokenHash,
      accountStatus: accounts.status,
    })
    .from(userSessions)
    .innerJoin(accounts, eq(accounts.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.id, parsed.sessionId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (
    !session ||
    session.accountStatus !== "active" ||
    !refreshSecretsMatch(parsed.secret, session.refreshTokenHash)
  ) {
    throw new AppError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Refresh token is invalid or expired.",
    );
  }

  const nextSecret = createRefreshSecret();
  const [updated] = await db
    .update(userSessions)
    .set({
      refreshTokenHash: hashRefreshSecret(nextSecret),
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(userSessions.id, session.id),
        eq(userSessions.refreshTokenHash, session.refreshTokenHash),
      ),
    )
    .returning({ id: userSessions.id });

  if (!updated) {
    throw new AppError(
      401,
      "REFRESH_TOKEN_REUSED",
      "Refresh token has already been rotated.",
    );
  }

  return issueTokenPair(session.userId, session.id, nextSecret);
}

export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)),
    );
}

export async function reactivateAccount(input: {
  email: string;
  password: string;
  session: SessionMetadata;
  requestId: string;
}) {
  const [account] = await db.select({
    id: accounts.id,
    status: accounts.status,
    passwordHash: accounts.passwordHash,
  }).from(accounts).where(eq(accounts.normalizedEmail, normalizedEmail(input.email))).limit(1);
  if (!account || account.status !== "deactivated" || !(await argon2.verify(account.passwordHash, input.password))) {
    throw new AppError(401, "REACTIVATION_FAILED", "Email or password is incorrect, or the account cannot be reactivated.");
  }
  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ status: "active", updatedAt: new Date() }).where(eq(accounts.id, account.id));
    await tx.insert(auditEvents).values({
      actorUserId: account.id,
      action: "account.reactivated",
      targetType: "account",
      targetId: account.id,
      requestId: input.requestId,
    });
  });
  return login({
    email: input.email,
    password: input.password,
    session: input.session,
  });
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const revoked = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.userId, userId),
        ne(userSessions.id, currentSessionId),
        isNull(userSessions.revokedAt),
      ),
    )
    .returning({ id: userSessions.id });

  return revoked.length;
}

export async function listSessions(userId: string): Promise<
  Array<{
    id: string;
    deviceName: string | null;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
    lastUsedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  }>
> {
  return db
    .select({
      id: userSessions.id,
      deviceName: userSessions.deviceName,
      userAgent: userSessions.userAgent,
      ipAddress: userSessions.ipAddress,
      createdAt: userSessions.createdAt,
      lastUsedAt: userSessions.lastUsedAt,
      expiresAt: userSessions.expiresAt,
      revokedAt: userSessions.revokedAt,
    })
    .from(userSessions)
    .where(eq(userSessions.userId, userId));
}
