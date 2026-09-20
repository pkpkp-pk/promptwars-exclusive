import type { DocumentType } from "@/lib/types";

/*
 * Per-type category taxonomies (AGENTS2.md §6a). Each supported document type
 * maps to the category names the classifier may assign, plus the human
 * labels the UI shows. Keeping this in one config (instead of letting the
 * model invent categories per call) is what makes risk flagging and
 * checklists consistent and testable per type.
 */

export const CATEGORY_MAP: Record<DocumentType, string[]> = {
  lease: [
    "rent",
    "deposit",
    "termination",
    "maintenance",
    "utilities",
    "renewal",
    "subletting",
    "other",
  ],
  freelance_contract: [
    "payment_terms",
    "ip_ownership",
    "termination",
    "confidentiality",
    "deliverables",
    "liability",
    "other",
  ],
  tos_privacy_policy: [
    "data_collection",
    "data_sharing",
    "user_rights",
    "account_termination",
    "liability",
    "dispute_resolution",
    "other",
  ],
  nda: [
    "confidential_info_definition",
    "obligations",
    "duration",
    "exceptions",
    "remedies",
    "other",
  ],
  employment_offer: [
    "compensation",
    "notice_period",
    "non_compete",
    "benefits",
    "termination",
    "ip_assignment",
    "other",
  ],
};

/** Display name for each type — used in the confirmation banner and copy. */
export const TYPE_LABELS: Record<DocumentType, string> = {
  lease: "Rental lease",
  freelance_contract: "Freelance / client contract",
  tos_privacy_policy: "Terms & privacy policy",
  nda: "Non-disclosure agreement",
  employment_offer: "Employment offer letter",
};

/** Human label for a category within a type; falls back to the raw name. */
export function categoryLabel(type: DocumentType, category: string): string {
  const labels: Record<DocumentType, Record<string, string>> = {
    lease: {
      rent: "Rent",
      deposit: "Security deposit",
      termination: "Termination",
      maintenance: "Maintenance",
      utilities: "Utilities",
      renewal: "Renewal",
      subletting: "Subletting",
      other: "Other",
    },
    freelance_contract: {
      payment_terms: "Payment terms",
      ip_ownership: "IP ownership",
      termination: "Termination",
      confidentiality: "Confidentiality",
      deliverables: "Deliverables",
      liability: "Liability",
      other: "Other",
    },
    tos_privacy_policy: {
      data_collection: "Data collection",
      data_sharing: "Data sharing",
      user_rights: "Your rights",
      account_termination: "Account termination",
      liability: "Liability",
      dispute_resolution: "Dispute resolution",
      other: "Other",
    },
    nda: {
      confidential_info_definition: "What's confidential",
      obligations: "Your obligations",
      duration: "Duration",
      exceptions: "Exceptions",
      remedies: "Remedies",
      other: "Other",
    },
    employment_offer: {
      compensation: "Compensation",
      notice_period: "Notice period",
      non_compete: "Non-compete",
      benefits: "Benefits",
      termination: "Termination",
      ip_assignment: "IP assignment",
      other: "Other",
    },
  };
  return labels[type][category] ?? category;
}
