import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/src/server/auth";

// Route Handler exigido pelo Better Auth (AD-3) — inclui o endpoint GET de
// callback do reset de senha (/api/auth/reset-password/:token) que redireciona
// para /redefinir-senha?token=... (ou ?error=INVALID_TOKEN).
export const { GET, POST } = toNextJsHandler(auth);
