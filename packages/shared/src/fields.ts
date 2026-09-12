import { z } from 'zod';
import {
  MAX_CUSTOM_SCRIPT_LENGTH,
  MAX_FIELDS_PER_FORM,
  MAX_OPTIONS_PER_SELECT,
  MAX_SECTIONS_PER_FORM,
  MAX_TEXT_LENGTH,
} from './constants.js';
import { normalizePlPhone } from './phone.js';

/**
 * Definicja pól buildera. Ten plik jest JEDYNYM źródłem prawdy o kształcie
 * `forms.schema_json` — frontend renderuje z niego formularz, backend
 * waliduje nim odpowiedzi uczestnika. Zero dryfu walidacji.
 */

export const FIELD_TYPES = ['text', 'email', 'tel', 'number', 'select', 'checkbox', 'date'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const fieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Klucz pola: małe litery, cyfry i podkreślenia, zaczyna się od litery');

const baseField = z.object({
  key: fieldKey,
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
});

export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  baseField.extend({ type: z.literal('text'), placeholder: z.string().max(200).optional() }),
  baseField.extend({ type: z.literal('email') }),
  baseField.extend({ type: z.literal('tel') }),
  baseField.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  baseField.extend({
    type: z.literal('select'),
    options: z.array(z.string().min(1).max(200)).min(1).max(MAX_OPTIONS_PER_SELECT),
  }),
  baseField.extend({ type: z.literal('checkbox') }),
  baseField.extend({ type: z.literal('date') }),
]);

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

const sectionIdSchema = z.string().min(1).max(64);

export const formSection = z.object({
  id: sectionIdSchema,
  name: z.string().min(1).max(200),
  fields: z.array(fieldDefinitionSchema).default([]),
});

export type FormSection = z.infer<typeof formSection>;

export const formSchemaJson = z
  .object({
    sections: z.array(formSection).max(MAX_SECTIONS_PER_FORM).default([]),
    /**
     * Własny kod JS uruchamiany na stronie publicznego formularza (np. ukrywanie sekcji
     * w zależności od kontekstu). Konfigurowany tylko w panelu admina — nigdy nie jest
     * renderowany jako pole widoczne dla uczestnika.
     */
    customScript: z.string().max(MAX_CUSTOM_SCRIPT_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    const seenSectionIds = new Set<string>();
    let totalFields = 0;

    for (const section of value.sections) {
      if (seenSectionIds.has(section.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Zduplikowane id sekcji: ${section.id}`,
          path: ['sections'],
        });
      }
      seenSectionIds.add(section.id);
      totalFields += section.fields.length;
    }

    if (totalFields > MAX_FIELDS_PER_FORM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Zbyt wiele pól: maksymalnie ${MAX_FIELDS_PER_FORM} na formularz`,
        path: ['sections'],
      });
    }

    const seenKeys = new Set<string>();
    for (const section of value.sections) {
      for (const field of section.fields) {
        if (seenKeys.has(field.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Zduplikowany klucz pola: ${field.key}`,
            path: ['sections'],
          });
        }
        seenKeys.add(field.key);
      }
    }
  });

export type FormSchemaJson = z.infer<typeof formSchemaJson>;

export const EMPTY_FORM_SCHEMA: FormSchemaJson = { sections: [] };

/** Spłaszcza pola ze wszystkich sekcji — do walidacji odpowiedzi i eksportu, gdzie kolejność sekcji nie ma znaczenia. */
export function flattenSections(sections: FormSection[]): FieldDefinition[] {
  return sections.flatMap((section) => section.fields);
}

/** Wartość pojedynczej odpowiedzi po walidacji. */
export type AnswerValue = string | number | boolean;

/**
 * Buduje walidator odpowiedzi uczestnika na podstawie definicji pól.
 * Ten sam walidator działa w przeglądarce (UX) i na serwerze (bezpieczeństwo).
 */
export function buildAnswersSchema(fields: FieldDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let validator: z.ZodTypeAny;

    switch (field.type) {
      case 'text':
        validator = z.string().trim().max(MAX_TEXT_LENGTH);
        if (field.required) validator = (validator as z.ZodString).min(1, 'Pole wymagane');
        break;
      case 'email':
        validator = z.string().trim().toLowerCase().email('Niepoprawny adres e-mail').max(320);
        break;
      case 'tel':
        validator = z
          .string()
          .trim()
          .transform((v, ctx) => {
            if (v === '') return '';
            const normalized = normalizePlPhone(v);
            if (!normalized) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Niepoprawny numer telefonu (+48)' });
              return z.NEVER;
            }
            return normalized;
          });
        break;
      case 'number': {
        let numberValidator = z.coerce.number({ invalid_type_error: 'Wartość musi być liczbą' });
        if (field.min !== undefined) numberValidator = numberValidator.min(field.min);
        if (field.max !== undefined) numberValidator = numberValidator.max(field.max);
        validator = numberValidator;
        break;
      }
      case 'select':
        validator = z.enum([field.options[0] as string, ...field.options.slice(1)]);
        break;
      case 'checkbox':
        validator = field.required
          ? z.literal(true, { errorMap: () => ({ message: 'Zgoda jest wymagana' }) })
          : z.boolean();
        break;
      case 'date':
        validator = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data w formacie RRRR-MM-DD')
          .refine((v) => !Number.isNaN(Date.parse(v)), 'Niepoprawna data');
        break;
    }

    // Pola nieobowiązkowe (poza checkboxem) mogą być pominięte lub puste.
    if (!field.required && field.type !== 'checkbox') {
      validator = z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? undefined : v),
        validator.optional(),
      );
    }
    if (!field.required && field.type === 'checkbox') {
      validator = z.preprocess((v) => (v === undefined || v === null ? false : v), validator);
    }
    if (field.required && field.type === 'tel') {
      validator = (validator as z.ZodTypeAny).refine((v) => v !== '', 'Pole wymagane');
    }

    shape[field.key] = validator;
  }

  // strict: odrzucamy nieznane klucze, żeby nikt nie wstrzyknął śmieci do payload_json.
  return z.object(shape).strict();
}
