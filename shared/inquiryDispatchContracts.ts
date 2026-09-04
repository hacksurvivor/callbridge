import {
  INQUIRY_FORBIDDEN_ACTIONS,
  parseInquiryCallContract,
  type InquiryCallContract,
} from "./inquiryContracts.js";

export type InquiryDispatchRequest = {
  taskId: string;
  attemptId: string;
  ownerId: string;
  confirmedRevision: number;
  confirmedExecutionRevision: string;
  dispatchIdempotencyKey: string;
  contract: InquiryCallContract;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function containsSpeechControlInjection(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bignore\b.{0,80}\b(?:rule|rules|instruction|instructions|prompt|prompts)\b/.test(normalized) ||
    /\b(?:reveal|show|repeat|print|leak)\b.{0,60}\b(?:system|developer|internal)\b.{0,40}\b(?:prompt|instruction|instructions|secret|secrets)\b/.test(normalized) ||
    /(?:^|\s)ignor(?:ă|a)(?=\s).{0,80}(?:regul|instrucțiun|prompt)/.test(normalized) ||
    /(?:^|\s)(?:dezvăluie|arată|repetă|tipărește)(?=\s).{0,60}(?:sistem|dezvoltator|intern)/.test(normalized) ||
    /(?:игнор|раскр|покаж|повтор|напечат).{0,80}(?:правил|инструкц|промпт|систем|секрет)/.test(normalized) ||
    /(?:^|[.!?]\s+)(?:please\s+)?(?:book|reserve|cancel|pay|charge|purchase|buy|accept|agree|authorize)\b/.test(normalized) ||
    /\bmake\s+(?:a|the|any)\s+(?:reservation|booking|payment|purchase|commitment)\b/.test(normalized)
  );
}

const SAFE_OBJECTIVE_START = /^(?:ask|collect|find out|clarify|confirm|inquire|learn|check|determine|understand|gather|get information)\b/i;
const SAFE_QUESTION_START = /^(?:who|what|when|where|why|how|which|until|is|are|am|do|does|did|can|could|may|might|will|would|should|has|have|had|must)\b/i;
const SAFE_PLAYBOOK_START = /^(?:ask|clarify|deliver|disclose|thank|end|if|when|do not|never|confirm that|repeat the approved)\b/i;
const FORBIDDEN_ACTION_WORD = /\b(?:book|reserve|cancel|pay|charge|purchase|buy|accept|agree|authorize|change|modify|redirect|release|order|schedule)\b/i;
const FORBIDDEN_CONFIRMATION = /\bconfirm\b.{0,60}\b(?:booking|reservation|payment|purchase|charge|fee|terms?|commitment|order)\b/i;
const ROMANIAN_SAFE_OBJECTIVE_START = /^(?:întreabă|află|clarifică|verifică|determină|înțelege|colectează|obține informații)(?=\s|$)/i;
const ROMANIAN_SAFE_QUESTION_START = /^(?:cine|ce|când|unde|de ce|cum|care|până când|este|sunt|e|mă|în ce|ai|a fost|aveți|au|poți|puteți|poate|ar|va|trebuie)(?=\s|$)/i;
const ROMANIAN_ACTION_REQUEST = /(?:^|[.!?,;:]\s*)(?:te rog\s+)?(?:rezervă|anulează|plătește|taxează|cumpără|acceptă|autorizează|confirmă|schimbă|modifică|redirecționează|eliberează|comandă|programează)|(?:poți|puteți|vreau să|aș dori să|apoi|și)\s+(?:rezerv(?:a|ă)|anula|plăti|taxa|cumpăr(?:a|ă)|accepta|autoriza|confirma|schimba|modifica|redirecționa|elibera|comanda|programa)/i;
const RUSSIAN_SAFE_OBJECTIVE_START = /^(?:спрос|узна|уточн|провер|определ|поня|собер|получ)/i;
const RUSSIAN_SAFE_QUESTION_START = /^(?:кто|что|когда|где|почему|как|какой|какая|какие|до когда|есть ли|является ли|можно ли|может ли|нужно ли|должен ли|должна ли|вы|ты)/i;
const RUSSIAN_ACTION_REQUEST = /(?:^|[.!?,;:]\s*)(?:пожалуйста\s+)?(?:заброни|зарезервир|отмен|оплат|спиш|куп|прими|соглас|авториз|подтверд|измени|перенаправ|освобод|закаж|запланир)|(?:можно ли|можете|можешь|хочу|затем|потом|и)\s+(?:заброни|зарезервир|отмен|оплат|спис|куп|приня|соглас|авториз|подтверд|измен|перенаправ|освобод|заказ|запланир)/i;
const ACTION_REQUEST = /(?:^|[.!?]\s+)(?:please\s+)?(?:book|reserve|cancel|pay|charge|purchase|buy|accept|agree|authorize|change|modify|redirect|release|order|schedule)\b|\b(?:ask|tell|have|instruct)\s+(?:them|the recipient|the provider|the business)\s+to\s+(?:book|reserve|cancel|pay|charge|purchase|buy|accept|agree|authorize|change|modify|redirect|release|order|schedule)\b|\b(?:can|could|would|will|should)\s+(?:you|i|we)\s+(?:book|reserve|cancel|pay|charge|purchase|buy|accept|agree|authorize|change|modify|redirect|release|order|schedule)\b|\bmake\s+(?:a|the|any)\s+(?:reservation|booking|payment|purchase|commitment|change)\b/i;

function unsafeSpokenUserData(
  input: { label: string; value: string; kind: "objective" | "question" | "playbook" },
  callLanguage: string,
): boolean {
  const normalized = input.value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const primaryLanguage = callLanguage.toLowerCase().split("-")[0];
  const localizedForbidden = primaryLanguage === "ro"
    ? ROMANIAN_ACTION_REQUEST.test(normalized)
    : primaryLanguage === "ru"
      ? RUSSIAN_ACTION_REQUEST.test(normalized)
      : false;
  if (
    containsSpeechControlInjection(normalized)
    || FORBIDDEN_ACTION_WORD.test(normalized)
    || FORBIDDEN_CONFIRMATION.test(normalized)
    || localizedForbidden
    || ACTION_REQUEST.test(normalized)
  ) return true;
  if (input.kind === "objective") {
    const localizedSafe = primaryLanguage === "ro"
      ? ROMANIAN_SAFE_OBJECTIVE_START.test(normalized)
      : primaryLanguage === "ru"
        ? RUSSIAN_SAFE_OBJECTIVE_START.test(normalized)
        : false;
    return !SAFE_OBJECTIVE_START.test(normalized) && !localizedSafe;
  }
  if (input.kind === "question") {
    const localizedSafe = primaryLanguage === "ro"
      ? ROMANIAN_SAFE_QUESTION_START.test(normalized)
      : primaryLanguage === "ru"
        ? RUSSIAN_SAFE_QUESTION_START.test(normalized)
        : false;
    return (!SAFE_QUESTION_START.test(normalized) && !localizedSafe) || !normalized.endsWith("?");
  }
  return !SAFE_PLAYBOOK_START.test(normalized);
}

export function validateInquiryDispatchRequest(input: unknown): InquiryDispatchRequest {
  if (!input || typeof input !== "object") throw new Error("Dispatch request is invalid");
  const value = input as Record<string, unknown>;
  const confirmedRevision = value.confirmedRevision;
  if (!Number.isInteger(confirmedRevision) || Number(confirmedRevision) < 1) {
    throw new Error("Confirmed revision is invalid");
  }
  const contract = parseInquiryCallContract(value.contract);
  const spokenUserData = [
    { label: "objective", value: contract.objective, kind: "objective" as const },
    ...contract.questions.map(({ id, prompt }) => ({ label: `question:${id}`, value: prompt, kind: "question" as const })),
    ...(contract.playbook?.steps.map(({ id, instruction }) => ({ label: `playbook:${id}`, value: instruction, kind: "playbook" as const })) ?? []),
  ];
  const unsafeSpeech = spokenUserData.find((field) => unsafeSpokenUserData(field, contract.languages.call));
  if (unsafeSpeech) throw new Error(`Inquiry speech data is unsafe (${unsafeSpeech.label})`);
  if (
    contract.policy.authority !== "gather_information_only" ||
    contract.policy.maxAttempts !== 1 ||
    contract.policy.automaticRetry ||
    contract.policy.audioRecording
  ) {
    throw new Error("Inquiry authority is invalid");
  }
  if (
    contract.policy.forbiddenActions.length !== INQUIRY_FORBIDDEN_ACTIONS.length ||
    !INQUIRY_FORBIDDEN_ACTIONS.every((action) => contract.policy.forbiddenActions.includes(action))
  ) {
    throw new Error("Inquiry forbidden-action boundary is incomplete");
  }
  return {
    taskId: requiredText(value.taskId, "Task ID"),
    attemptId: requiredText(value.attemptId, "Attempt ID"),
    ownerId: requiredText(value.ownerId, "Owner ID"),
    confirmedRevision: Number(confirmedRevision),
    confirmedExecutionRevision: requiredText(value.confirmedExecutionRevision, "Confirmed execution revision"),
    dispatchIdempotencyKey: requiredText(value.dispatchIdempotencyKey, "Dispatch idempotency key"),
    contract,
  };
}
