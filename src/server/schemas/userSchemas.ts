import { z } from "zod";

export const LEDGER_ROLES = [
  'Company Owner',
  'Company Administrator',
  'Approver',
  'Reviewer',
  'Accountant',
  'Bookkeeper',
  'Auditor',
  'Read-only User'
] as const;

export type ValidLedgerRole = (typeof LEDGER_ROLES)[number];

export const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address"),
  displayName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters long")
    .max(100, "Full name cannot exceed 100 characters"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long"),
  role: z.enum(LEDGER_ROLES).optional().default('Read-only User'),
  roles: z.array(z.enum(LEDGER_ROLES)).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional().default('ACTIVE'),
  customPermissions: z.array(z.string()).optional(),
  requirePasswordChange: z.boolean().optional().default(false)
});

export const updateUserSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters long")
    .max(100, "Full name cannot exceed 100 characters")
    .optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please provide a valid email address")
    .optional(),
  role: z.enum(LEDGER_ROLES).optional(),
  roles: z.array(z.enum(LEDGER_ROLES)).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  disableAccount: z.boolean().optional(),
  deleteAccount: z.boolean().optional(),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters long")
    .optional()
    .or(z.literal('')),
  requirePasswordChange: z.boolean().optional()
});

export const updateMemberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().trim().max(250).optional()
});

export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(6, "New password must be at least 6 characters long")
});

export const updateMemberPermissionsSchema = z.object({
  customPermissions: z.array(z.string())
});
