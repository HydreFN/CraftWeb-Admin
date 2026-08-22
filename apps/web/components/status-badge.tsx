import { STATUS_LABELS, type ProspectStatus } from "@prospection/core";
import { Badge } from "./ui";

const COLORS: Record<
  ProspectStatus,
  "gray" | "green" | "red" | "yellow" | "blue" | "purple" | "amber" | "slate"
> = {
  NOUVEAU: "gray",
  EN_ATTENTE: "gray",
  INTERESSE: "green",
  DEMANDE_DE_PRIX: "amber",
  PAS_INTERESSE: "red",
  A_RELANCER: "yellow",
  QUESTION: "blue",
  A_VERIFIER: "purple",
  EMAIL_INVALIDE: "red",
  EXCLU: "slate",
};

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge color={COLORS[status]}>{STATUS_LABELS[status]}</Badge>;
}
