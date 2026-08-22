"use client";

import { Button } from "./ui";

/** Bouton de soumission avec confirmation (actions destructives). */
export function ConfirmSubmit({
  children,
  message,
  variant = "danger",
}: {
  children: React.ReactNode;
  message: string;
  variant?: "danger" | "outline";
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
