export type CaseStatus = "open" | "in_review" | "resolved" | "dismissed";

export function canTransitionCase(
  from: CaseStatus, to: CaseStatus
): boolean {
  return (from === "open" && to === "in_review") ||
    (from === "in_review" && (to === "resolved" || to === "dismissed"));
}

export function disputeDocumentId(
  serviceType: "ride" | "rental",
  serviceId: string, openerUid: string
): string {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(serviceId) ||
      !/^[a-zA-Z0-9_-]{4,128}$/.test(openerUid)) {
    throw new Error("Invalid dispute identity");
  }
  return serviceType + "_" + serviceId + "_" + openerUid;
}

export type CasePriority = "low" | "normal" | "high";
export function initialDisputePriority(topic: string): CasePriority {
  return topic === "safety" ? "high" : "normal";
}
export function canEditCasePriority(status: CaseStatus): boolean {
  return status === "open" || status === "in_review";
}
