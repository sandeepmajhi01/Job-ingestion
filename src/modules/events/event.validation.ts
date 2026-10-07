import { z } from "zod";

const nonBlankIdentifier = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, {
    message: "Identifier must not contain surrounding whitespace",
  });

const payloadSchema = z.object({
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  location: z.string().trim().min(1),

  experienceMin: z.number().int().min(0).max(50),

  experienceMax: z.number().int().min(0).max(50),

  applyUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), {
      message: "applyUrl must use HTTPS",
    }),

  skills: z
    .array(z.string().trim().min(1))
    .transform((skills) => {
      const normalized: string[] = [];

      for (const skill of skills) {
        const value = skill.toLowerCase();

        if (!normalized.includes(value)) {
          normalized.push(value);
        }
      }

      return normalized;
    }),
});

export const eventSchema = z
  .object({
    tenantId: nonBlankIdentifier,
    sourceId: nonBlankIdentifier,
    eventId: nonBlankIdentifier,
    externalJobId: nonBlankIdentifier,

    version: z.number().int().positive().safe(),

    operation: z.enum(["upsert", "archive"]),

    payload: payloadSchema.optional(),
  })
  .superRefine((event, ctx) => {
    if (event.operation === "upsert" && !event.payload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "payload is required for upsert",
      });
    }

    if (
      event.payload &&
      event.payload.experienceMin > event.payload.experienceMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "experienceMin"],
        message: "experienceMin cannot exceed experienceMax",
      });
    }

    if (event.operation === "archive" && event.payload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "archive must not contain payload",
      });
    }
  });

export type CreateEventInput = z.infer<typeof eventSchema>;
