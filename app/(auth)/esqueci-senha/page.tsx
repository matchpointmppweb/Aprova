import type { Metadata } from "next";

import { EsqueciSenhaForm } from "@/src/components/auth/esqueci-senha-form";

export const metadata: Metadata = {
  title: "Esqueci minha senha — Raiz",
};

export default function EsqueciSenhaPage() {
  return <EsqueciSenhaForm />;
}
