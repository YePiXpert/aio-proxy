import { zod } from '@aio-proxy/plugin-sdk';

export const accountOptionsSchema = zod.object({
  apiKey: zod.string().trim().min(1),
});

export const credentialSchema = zod.object({
  apiKey: zod.string().min(1),
});

export type OpenCodeGoAccountOptions = zod.infer<typeof accountOptionsSchema>;
export type OpenCodeGoCredential = zod.infer<typeof credentialSchema>;
