export function validatePresentationData(kind: string, data: unknown): void;
export function selectEvidence<
  T extends {
    id: string;
    category: string;
    title: string;
    claim: string;
    boundary: string;
    values: Record<string, string>;
  },
>(items: T[], category?: string, query?: string): T[];
