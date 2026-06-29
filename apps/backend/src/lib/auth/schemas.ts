import { KEY_TYPES, ROLES } from '@playwright-reports/shared';
import { z } from 'zod';

const username = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(64, 'Username must be at most 64 characters');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(256, 'Password must be at most 256 characters');

export const signinSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const setupSchema = z.object({
  apiToken: z.string().min(1),
  username,
  password,
});

export const registerSchema = z.object({
  inviteCode: z.string().min(1).optional(),
  username,
  password,
});

export const changePasswordSchema = z.object({
  username: z.string().min(1),
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const updateUserSchema = z
  .object({
    role: z.enum([ROLES.admin, ROLES.member, ROLES.readonly]).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, {
    message: 'Provide role and/or disabled',
  });

export const resetCompleteSchema = z.object({
  token: z.string().min(1),
  password,
});

export const createInviteSchema = z.object({
  // ISO-8601 UTC so expiry compares lexicographically as stored.
  expiresAt: z.iso.datetime().optional(),
  maxUses: z.number().int().positive().optional(),
});

export const createKeySchema = z.object({
  label: z.string().trim().min(1).max(120),
  type: z.enum([KEY_TYPES.reporter, KEY_TYPES.cli, KEY_TYPES.share]),
  // ISO datetime so resolveApiKey's Date.parse can't yield NaN (which never expires).
  expiresAt: z.iso.datetime().optional(),
  service: z.boolean().optional(), // admin-only: owner-less service key
});
