import "server-only";

import { prisma } from "@/src/server/repositories/db";

// Revogação da sessão RECÉM-CRIADA (02-11-2026).
//
// O diferido da Story 6.2: quando `entrarAction` recusa a entrada depois de
// `signInEmail` (conta sem ambiente utilizável, ou promoção de convidado que
// falhou), ela chamava `auth.api.signOut({ headers: await headers() })`. Esses
// são os cabeçalhos da REQUISIÇÃO, e o cookie da sessão nasceu DENTRO desta
// mesma requisição — então não está ali. O signOut não encontrava sessão
// nenhuma, não revogava nada, e a sessão sobrevivia à recusa.
//
// O efeito visível era o repique: `app/(auth)/layout.tsx` decide "já
// autenticado" por `getSession()`, encontrava a sessão viva e mandava para
// "/"; a guarda do painel não achava ambiente utilizável e mandava de volta
// para "/login". A pessoa ficava entre as duas telas.
//
// A correção não passa pelo cookie. A sessão do projeto é em BANCO, sem cache
// de cookie (ver `session` em src/server/auth/index.ts): apagar a linha
// invalida o cookie que o navegador acabou de receber, porque a próxima
// leitura não encontra sessão para aquele token. Determinístico, e testável
// contra o banco real — ao contrário de qualquer coisa que dependa de ordem
// de cabeçalhos.
//
// `signOut` continua correto nos outros pontos de uso (src/server/auth/
// sessao.ts): ali a requisição JÁ carrega o cookie.

/// Apaga a sessão cujo token veio de `signInEmail` nesta requisição.
///
/// `token` nulo não é erro: significa que `signInEmail` não criou sessão (o
/// fluxo já falhou antes), e não há o que revogar.
///
/// Nunca lança. Quem chama está no meio de RECUSAR uma entrada, e uma falha
/// ao limpar não pode virar erro no lugar da recusa — mas deixa rastro, para
/// uma sessão órfã não ficar invisível.
export async function revogarSessaoRecemCriada(token: string | null | undefined): Promise<void> {
  if (!token) return;

  try {
    await prisma.session.deleteMany({ where: { token } });
  } catch (erro) {
    const { registrarFalha } = await import("@/src/server/log");
    registrarFalha({ operacao: "revogarSessaoRecemCriada" }, erro);
  }
}
