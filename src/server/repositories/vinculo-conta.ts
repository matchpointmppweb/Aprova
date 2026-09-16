import "server-only";

import type { StatusUsuario } from "@prisma/client";

import { prisma } from "./db";

// Repositório do VinculoConta (AD-1) — única via de leitura do vínculo.
//
// Story 6.2 (fase contract da leitura): a conta ativa e o perfil de acesso de
// uma identidade passam a sair daqui, e não mais das colunas
// `Usuario.contaId`/`Usuario.perfilAcessoId`. As colunas continuam existindo e
// continuam sendo escritas pelo dual-write da 6.1 (src/server/repositories/
// usuario.ts) — só deixaram de ser lidas no caminho de autenticação. A remoção
// delas é a Story 6.3.

/// Status do vínculo (e da identidade) que dão acesso a uma sessão já
/// estabelecida — só quem está Ativo opera o sistema.
///
/// `as const satisfies readonly StatusUsuario[]`: são allowlists de
/// autorização exportadas — `const` protegeria só o binding, deixando o
/// conteúdo do array mutável por qualquer importador.
export const STATUS_COM_ACESSO = ["Ativo"] as const satisfies readonly StatusUsuario[];

/// Status que permitem entrar pelo login. ConvitePendente entra (a senha já
/// foi definida pelo link de convite) e é promovido a Ativo por
/// entrarAction/ativarUsuarioConvidado.
export const STATUS_COM_LOGIN = [
  "Ativo",
  "ConvitePendente",
] as const satisfies readonly StatusUsuario[];

// Revalida contra o banco, a cada requisição, que o vínculo entre a identidade
// e a conta existe e está utilizável (NFR6): vínculo desativado ou apagado
// nega acesso já na requisição seguinte, sem esperar o token de sessão
// expirar. Os três critérios são aplicados juntos, no próprio `where`:
// identidade com status que permita acesso, vínculo com status que permita
// acesso e `Conta.status = "Ativa"`.
//
// `take: 2` de propósito: nunca precisamos de mais de duas linhas — uma para
// resolver, a segunda apenas para saber que há ambiguidade.
async function listarVinculosUtilizaveis(
  usuarioId: string,
  statusPermitidos: readonly StatusUsuario[],
) {
  return prisma.vinculoConta.findMany({
    where: {
      usuarioId,
      status: { in: [...statusPermitidos] },
      usuario: { status: { in: [...statusPermitidos] } },
      conta: { status: "Ativa" },
    },
    include: { usuario: true, conta: true, perfilAcesso: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
}

// Resolve a identidade autenticada + conta ativa + perfil pelo vínculo,
// devolvendo EXATAMENTE a forma que `buscarUsuarioAutenticado` devolvia
// (campos de Usuario + `conta` + `perfilAcesso`), com `contaId` e
// `perfilAcessoId` sobrescritos pelos do vínculo. É assim que o AD-23 se
// cumpre: nenhuma Server Action, nenhum repositório de domínio e nenhum uso de
// `contaId` precisou mudar — inclusive can(), que continua recebendo este
// mesmo objeto.
//
// Fail-closed: zero vínculos utilizáveis nega acesso; mais de um (só possível
// a partir da 6.3, e com a escolha entre contas só na 6.4) também nega —
// nunca escolher um vínculo arbitrariamente.
export async function resolverUsuarioAutenticadoPeloVinculo(
  usuarioId: string,
  statusPermitidos: readonly StatusUsuario[],
) {
  const vinculos = await listarVinculosUtilizaveis(usuarioId, statusPermitidos);

  if (vinculos.length > 1) {
    // Não deveria ser possível antes da Story 6.4 (a escolha entre contas só
    // passa a existir lá) — se acontecer, a negação em si é correta, mas
    // silenciosa demais para diagnosticar. Só servidor, nada chega ao
    // cliente: a Server Action/guarda devolve a mesma recusa genérica de
    // sempre, sem revelar nada sobre o estado dos vínculos.
    console.warn(
      `[vinculo-conta] mais de um vínculo utilizável para a identidade ${usuarioId} — acesso negado (fail-closed). A escolha entre contas é a Story 6.4.`,
    );
    return null;
  }

  if (vinculos.length === 0) {
    return null;
  }

  const [vinculo] = vinculos;

  return {
    ...vinculo.usuario,
    contaId: vinculo.contaId,
    perfilAcessoId: vinculo.perfilAcessoId,
    conta: vinculo.conta,
    perfilAcesso: vinculo.perfilAcesso,
    // `status` no objeto composto é o da IDENTIDADE (veio do spread). O do
    // vínculo precisa de nome próprio para não colidir — e é indispensável:
    // a guarda de sessão exige `Ativo` nos dois lados, então quem decide
    // promover um convidado no login tem de olhar os dois. A partir da Story
    // 6.6 (identidade Ativa numa conta, recém-convidada em outra) a
    // divergência entre eles vira estado rotineiro.
    statusDoVinculo: vinculo.status,
  };
}
