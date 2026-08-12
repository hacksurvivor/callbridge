export function retentionDeleteAt(input: {
  mode: "save_for_30_days" | "no_save";
  completedAt: Date;
  endDate?: string;
  extensionDays?: number;
}): Date {
  if (input.mode === "no_save") return input.completedAt;
  const basis = input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : input.completedAt;
  if (Number.isNaN(basis.getTime())) throw new Error("Retention basis is invalid");
  const days = 30 + (input.extensionDays ?? 0);
  if (!Number.isInteger(days) || days < 30 || days > 395) throw new Error("Retention extension is invalid");
  return new Date(basis.getTime() + days * 86_400_000);
}

export function isRetentionExpired(input: Parameters<typeof retentionDeleteAt>[0] & { now: Date }): boolean {
  return input.now >= retentionDeleteAt(input);
}
