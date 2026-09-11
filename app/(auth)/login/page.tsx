import type { Metadata } from "next";

import { LoginForm } from "@/src/components/auth/login-form";

export const metadata: Metadata = {
  title: "Entrar — Raiz",
};

export default function LoginPage() {
  return <LoginForm />;
}
