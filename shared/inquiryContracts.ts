import { z } from "zod";

export const INQUIRY_CONTRACT_SCHEMA_VERSION = 1 as const;
export const INQUIRY_EXECUTION_REVISION_PREFIX = "inquiry-v1:sha256:" as const;

export const INQUIRY_CATEGORIES = [
  "accommodation",
  "restaurant",
  "healthcare",
  "government",
  "transport",
  "delivery",
  "retail",
  "property",
  "vehicle",
  "professional_service",
  "other",
] as const;

export const INQUIRY_FORBIDDEN_ACTIONS = [
  "book",
  "change_reservation",
  "cancel",
  "pay",
  "accept_fee",
  "accept_terms",
  "make_commitment",
] as const;

export const INQUIRY_REQUIRED_DISCLOSURE_CLAIMS = [
  "ai_identity",
  "speech_transcription",
  "no_audio_recording",
  "minimal_evidence_retention",
] as const;

const SERVER_DISCLOSURES: Readonly<Record<string, string>> = {
  en: "This is an AI assistant calling for a user. Speech is transcribed, audio is not recorded, and minimal structured evidence is retained temporarily.",
  es: "Soy un asistente de IA que llama en nombre de una persona. La conversación se transcribe, el audio no se graba y solo se conserva temporalmente evidencia estructurada mínima.",
  hi: "मैं उपयोगकर्ता की ओर से कॉल करने वाला एक एआई सहायक हूँ। बातचीत का लिप्यंतरण होता है, ऑडियो रिकॉर्ड नहीं होता, और न्यूनतम संरचित साक्ष्य अस्थायी रूप से रखा जाता है।",
  ja: "これはユーザーに代わって電話をしているAIアシスタントです。会話は文字起こしされ、音声は録音されません。必要最小限の構造化された証拠のみが一時的に保持されます。",
  ka: "მე ვარ ხელოვნური ინტელექტის ასისტენტი და მომხმარებლის სახელით ვრეკავ. საუბარი გადაიწერება ტექსტად, აუდიო არ იწერება და მინიმალური სტრუქტურირებული მტკიცებულება დროებით ინახება.",
  kk: "Мен пайдаланушы атынан қоңырау шалып тұрған ЖИ көмекшісімін. Сөйлеу мәтінге айналады, аудио жазылмайды және ең аз құрылымдалған дәлел уақытша сақталады.",
  ro: "Sunt un asistent AI care sună pentru un utilizator. Conversația este transcrisă, sunetul nu este înregistrat, iar dovezile structurate minime sunt păstrate temporar.",
  ru: "Я — ИИ-ассистент и звоню от имени пользователя. Разговор преобразуется в текст, аудиозапись не ведётся, а минимальные структурированные данные временно сохраняются.",
  th: "นี่คือผู้ช่วย AI ที่โทรในนามของผู้ใช้ ระบบถอดเสียงการสนทนา ไม่มีการบันทึกเสียง และเก็บหลักฐานแบบมีโครงสร้างเท่าที่จำเป็นไว้ชั่วคราว",
};

/** User input never controls the words spoken as Concierge's legal/safety disclosure. */
export function serverInquiryDisclosure(callLanguage: string): {
  id: string;
  locale: string;
  text: string;
  requiredClaims: InquiryDisclosureClaim[];
} {
  const requested = callLanguage.trim();
  const base = requested.split("-")[0]?.toLowerCase() ?? "en";
  const supported = SERVER_DISCLOSURES[base] ? base : "en";
  return {
    id: `callbridge-disclosure-${supported}-v1`,
    locale: supported === "en" && base !== "en" ? "en" : requested,
    text: SERVER_DISCLOSURES[supported]!,
    requiredClaims: [...INQUIRY_REQUIRED_DISCLOSURE_CLAIMS],
  };
}

export type InquiryForbiddenAction = (typeof INQUIRY_FORBIDDEN_ACTIONS)[number];
export type InquiryDisclosureClaim = (typeof INQUIRY_REQUIRED_DISCLOSURE_CLAIMS)[number];
export type InquiryExecutionRevision = `${typeof INQUIRY_EXECUTION_REVISION_PREFIX}${string}`;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const identifier = z.string().trim().regex(/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i);
const languageTag = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Must be a BCP 47 language tag");
const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Must be an ISO 3166-1 alpha-2 country code");
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Must be an ISO 4217 currency code");

const destinationSchema = z
  .object({
    displayName: boundedText(300),
    e164PhoneNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Must be an E.164 phone number"),
    countryCode,
    address: boundedText(500).optional(),
    website: z.string().trim().url().max(2_048).optional(),
  })
  .strict();

const questionSchema = z
  .object({
    id: identifier,
    prompt: boundedText(500),
    required: z.boolean(),
  })
  .strict();

const shareableFactSchema = z
  .object({
    id: identifier,
    label: boundedText(120),
    value: boundedText(1_000),
    shareWhen: boundedText(300).optional(),
  })
  .strict();

export const inquiryPlaybookSchema = z
  .object({
    id: identifier,
    revision: z.number().int().positive(),
    name: boundedText(120),
    source: z.enum(["system", "user_created"]),
    steps: z
      .array(
        z
          .object({
            id: identifier,
            instruction: boundedText(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((playbook, context) => {
    addDuplicateIdIssue(playbook.steps, context, ["steps"]);
  });

const policySchema = z
  .object({
    id: identifier,
    authority: z.literal("gather_information_only"),
    forbiddenActions: z.array(z.enum(INQUIRY_FORBIDDEN_ACTIONS)),
    maxAttempts: z.literal(1),
    automaticRetry: z.literal(false),
    maxConnectedSeconds: z.number().int().min(30).max(900),
    audioRecording: z.literal(false),
  })
  .strict()
  .superRefine((policy, context) => {
    const received = new Set(policy.forbiddenActions);
    if (
      received.size !== INQUIRY_FORBIDDEN_ACTIONS.length ||
      INQUIRY_FORBIDDEN_ACTIONS.some((action) => !received.has(action))
    ) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenActions"],
        message: "The complete Concierge forbidden-action boundary is required",
      });
    }
  });

export const inquiryCallContractSchema = z
  .object({
    schemaVersion: z.literal(INQUIRY_CONTRACT_SCHEMA_VERSION),
    category: z.enum(INQUIRY_CATEGORIES),
    destination: destinationSchema,
    objective: boundedText(1_000),
    questions: z.array(questionSchema).min(1).max(20),
    languages: z
      .object({
        call: languageTag,
        result: languageTag,
      })
      .strict(),
    context: z
      .object({
        privateBackground: boundedText(8_000).optional(),
        shareableFacts: z.array(shareableFactSchema).max(30),
      })
      .strict(),
    disclosure: z
      .object({
        id: identifier,
        locale: languageTag,
        text: boundedText(1_000),
        requiredClaims: z.array(z.enum(INQUIRY_REQUIRED_DISCLOSURE_CLAIMS)),
      })
      .strict(),
    playbook: inquiryPlaybookSchema.optional(),
    costCeiling: z
      .object({
        currency: currencyCode,
        maxTotalMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    policy: policySchema,
  })
  .strict()
  .superRefine((contract, context) => {
    addDuplicateIdIssue(contract.questions, context, ["questions"]);
    addDuplicateIdIssue(contract.context.shareableFacts, context, ["context", "shareableFacts"]);

    const claims = new Set(contract.disclosure.requiredClaims);
    if (
      claims.size !== INQUIRY_REQUIRED_DISCLOSURE_CLAIMS.length ||
      INQUIRY_REQUIRED_DISCLOSURE_CLAIMS.some((claim) => !claims.has(claim))
    ) {
      context.addIssue({
        code: "custom",
        path: ["disclosure", "requiredClaims"],
        message: "The complete Concierge disclosure envelope is required",
      });
    }
  })
  .transform((contract) => ({
    ...contract,
    disclosure: serverInquiryDisclosure(contract.languages.call),
    policy: {
      ...contract.policy,
      forbiddenActions: [...INQUIRY_FORBIDDEN_ACTIONS],
    },
  }));

export type InquiryCallContract = z.output<typeof inquiryCallContractSchema>;
export type InquiryPlaybook = z.output<typeof inquiryPlaybookSchema>;

export type InquiryContractValidation =
  | { ok: true; value: InquiryCallContract }
  | { ok: false; issues: Array<{ path: string; message: string }> };

export function validateInquiryCallContract(input: unknown): InquiryContractValidation {
  const result = inquiryCallContractSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function parseInquiryCallContract(input: unknown): InquiryCallContract {
  return inquiryCallContractSchema.parse(input);
}

export function parseInquiryPlaybook(input: unknown): InquiryPlaybook {
  return inquiryPlaybookSchema.parse(input);
}

/**
 * Returns the canonical execution payload. Object keys are sorted recursively;
 * array order is preserved because question and playbook order changes the call.
 * The returned JSON can contain private context and must never be logged.
 */
export function canonicalizeInquiryExecution(input: unknown): string {
  return JSON.stringify(sortJsonValue(parseInquiryCallContract(input)));
}

export async function computeInquiryExecutionRevision(
  input: unknown,
): Promise<InquiryExecutionRevision> {
  const canonical = canonicalizeInquiryExecution(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${INQUIRY_EXECUTION_REVISION_PREFIX}${hex}`;
}

export async function confirmationMatchesInquiryExecution(
  confirmedExecutionRevision: string | null | undefined,
  input: unknown,
): Promise<boolean> {
  if (!confirmedExecutionRevision) return false;
  return confirmedExecutionRevision === (await computeInquiryExecutionRevision(input));
}

type Identified = { id: string };

function addDuplicateIdIssue(
  values: readonly Identified[],
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "IDs must be unique",
    });
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}
