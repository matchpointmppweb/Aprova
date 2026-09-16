import "server-only";

import type { Prisma, StatusUsuario } from "@prisma/client";

import { prisma } from "./db";

// Repositório do VinculoConta (AD-1) — única via de leitura do vínculo.
//
// Story 6.2 (fase contract da leitura): a conta ativa e o perfil de acesso de
// uma identidade passam a sair daqui, e não mais das colunas
// `Usuario.contaId`/`Usuario.perfilAcessoId`. A Story 6.3 removeu essas
// colunas — o vínculo é agora a única fonte da informação, e não há mais
// dual-write a manter.
//
// Story 6.4: quando a identidade tem vínculo utilizável em mais de uma conta,
// a escolha passa a existir e vive na SESSÃO (`Session.contaAtivaId`) — que é
// tabela do nosso banco, logo escrita daqui (AD-1). A resolução aceita essa
// conta ativa como PONTEIRO (sempre revalidado contra o banco, NFR6/NFR2) e,
// sem ela, mantém a derivação por vínculo único da 6.2.

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

/// A lista que define QUANTOS ambientes esta pessoa pode escolher — e ela é a
/// mesma em todos os quatro pontos: enumerar as opções, decidir se há
/// ambiguidade, oferecer na tela e revalidar a escolha. Divergir aqui era um
/// buraco real: com um vínculo Ativo e outro ConvitePendente, contar por
/// STATUS_COM_ACESSO dava "um só" e a derivação ENTRAVA sem perguntar, enquanto
/// o login contava dois e mandava escolher — bastava navegar direto para "/"
/// para contornar o FR22.
///
/// É deliberadamente a lista mais ampla (a do login): um vínculo
/// ConvitePendente É um ambiente escolhível — quem o escolhe é promovido a
/// Ativo antes de entrar (concluirEntrada). O que continua exigindo `Ativo` nos
/// dois lados é o ACESSO ao painel, e isso é o `statusPermitidos` que a guarda
/// passa para resolver o vínculo escolhido — não a contagem.
///
/// Por ser invariante, e não configuração, não é parâmetro de ninguém: quem
/// enumera não escolhe a lista.
const STATUS_ESCOLHIVEL = STATUS_COM_LOGIN;

// Único construtor do predicado de "vínculo utilizável" (NFR6): identidade com
// status permitido, vínculo com status permitido e `Conta.status = "Ativa"`,
// sempre os três juntos no mesmo `where`.
//
// Existe como função — e não copiado em cada query — porque esta é a única
// invariante do épico que não pode divergir entre a consulta que OFERECE as
// opções e a que REVALIDA a escolha: se a segunda fosse mais frouxa que a
// primeira, a tela ofereceria o que a revalidação não aceita; se fosse mais
// estrita, aceitaria o que a tela não ofereceu.
function ondeVinculoUtilizavel(
  usuarioId: string,
  statusPermitidos: readonly StatusUsuario[],
  contaId?: string,
): Prisma.VinculoContaWhereInput {
  return {
    usuarioId,
    ...(contaId ? { contaId } : {}),
    status: { in: [...statusPermitidos] },
    usuario: { status: { in: [...statusPermitidos] } },
    conta: { status: "Ativa" },
  };
}

// Revalida contra o banco, a cada requisição, que o vínculo entre a identidade
// e a conta existe e está utilizável (NFR6): vínculo desativado ou apagado
// nega acesso já na requisição seguinte, sem esperar o token de sessão
// expirar.
//
// `take: 2` de propósito: nunca precisamos de mais de duas linhas — uma para
// resolver, a segunda apenas para saber que há ambiguidade.
async function listarVinculosUtilizaveis(
  usuarioId: string,
  statusPermitidos: readonly StatusUsuario[],
) {
  return prisma.vinculoConta.findMany({
    where: ondeVinculoUtilizavel(usuarioId, statusPermitidos),
    include: { usuario: true, conta: true, perfilAcesso: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
}

// Mesmíssimo predicado, acrescido da conta pedida. É o que revalida, contra o
// banco, uma conta ativa vinda da sessão OU escolhida na tela de seleção
// (NFR2): o `contaId` é tratado como palpite do cliente até esta consulta dizer
// o contrário — nunca se confia no que a sessão guardou nem no que a página
// ofereceu.
async function buscarVinculoUtilizavel(
  usuarioId: string,
  contaId: string,
  statusPermitidos: readonly StatusUsuario[],
) {
  return prisma.vinculoConta.findFirst({
    where: ondeVinculoUtilizavel(usuarioId, statusPermitidos, contaId),
    include: { usuario: true, conta: true, perfilAcesso: true },
  });
}

// Resolve a identidade autenticada + conta ativa + perfil pelo vínculo,
// devolvendo EXATAMENTE a forma que `buscarUsuarioAutenticado` devolvia
// (campos de Usuario + `conta` + `perfilAcesso`), com `contaId` e
// `perfilAcessoId` vindos do vínculo. Desde a Story 6.3 o spread de
// `vinculo.usuario` não traz mais esses dois campos (as colunas foram
// removidas), e a atribuição explícita abaixo é a única origem deles — o que
// já era o comportamento efetivo na 6.2. É assim que o AD-23 se
// cumpre: nenhuma Server Action, nenhum repositório de domínio e nenhum uso de
// `contaId` precisou mudar — inclusive can(), que continua recebendo este
// mesmo objeto.
//
// Fail-closed continua valendo, mas a Story 6.4 separa os dois motivos de
// recusa que a 6.2/6.3 colapsavam em `null`: ZERO vínculos utilizáveis é "não
// há ambiente para esta pessoa" (fim de linha — encerra a sessão), enquanto
// MAIS DE UM é "falta escolher" (recuperável — vai para a tela de seleção).
// Tratar os dois como a mesma coisa era o que trancava justamente quem o
// épico 6 veio habilitar. Por isso o retorno virou união discriminada: o
// chamador é obrigado a distinguir os casos, e não há mais como confundir
// ambiguidade com ausência.
//
// Nunca se escolhe um vínculo arbitrariamente — "ambiguo" não resolve nada,
// só diz que existe escolha a fazer.
export type ResolucaoDeVinculo =
  | { tipo: "resolvido"; usuario: UsuarioResolvidoPeloVinculo }
  | { tipo: "ambiguo" }
  | { tipo: "sem-ambiente" };

type VinculoComRelacoes = NonNullable<Awaited<ReturnType<typeof buscarVinculoUtilizavel>>>;

export type UsuarioResolvidoPeloVinculo = ReturnType<typeof compor>;

function compor(vinculo: VinculoComRelacoes) {
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

// `contaAtivaId` é OPCIONAL de propósito, e é o coração da 6.4:
//   - com ele (conta ativa gravada na sessão, ou escolha recém-submetida),
//     resolve aquele vínculo específico — revalidado contra o banco aqui
//     mesmo, a cada requisição (NFR6/NFR2);
//   - sem ele, mantém a derivação por vínculo único da 6.2 — quem tem um só
//     ambiente nunca precisou escolher nada, e nada precisa estar gravado.
//
// Uma conta ativa que não resolve (vínculo desativado/removido, conta
// suspensa, ou palpite forjado) NÃO é erro fatal: cai na contagem, e o
// chamador decide o que fazer com o valor obsoleto — limpá-lo da sessão e
// mandar escolher, no caso da guarda; recusar a escolha, no caso da Server
// Action.
//
// `statusPermitidos` governa o ACESSO ao vínculo resolvido (a guarda exige
// `Ativo` nos dois lados; o login aceita ConvitePendente, que promove em
// seguida). Ele NÃO governa a contagem: quantos ambientes existem para
// escolher é sempre STATUS_ESCOLHIVEL — ver o comentário daquela constante.
export async function resolverUsuarioAutenticadoPeloVinculo(
  usuarioId: string,
  statusPermitidos: readonly StatusUsuario[],
  contaAtivaId?: string | null,
): Promise<ResolucaoDeVinculo> {
  if (contaAtivaId) {
    const vinculo = await buscarVinculoUtilizavel(
      usuarioId,
      contaAtivaId,
      statusPermitidos,
    );

    if (vinculo) {
      return { tipo: "resolvido", usuario: compor(vinculo) };
    }
  }

  const escolhiveis = await listarVinculosUtilizaveis(usuarioId, STATUS_ESCOLHIVEL);

  if (escolhiveis.length > 1) {
    return { tipo: "ambiguo" };
  }

  if (escolhiveis.length === 0) {
    return { tipo: "sem-ambiente" };
  }

  // Um único ambiente escolhível não é escolha — é derivação. Mas derivar não
  // dispensa o critério de acesso: se o único vínculo não satisfaz
  // `statusPermitidos` (ex.: a guarda exige `Ativo` e ele está
  // ConvitePendente), não há ambiente utilizável AGORA.
  const [unico] = escolhiveis;
  const acessivel =
    statusPermitidos.includes(unico.status) &&
    statusPermitidos.includes(unico.usuario.status);

  return acessivel
    ? { tipo: "resolvido", usuario: compor(unico) }
    : { tipo: "sem-ambiente" };
}

// "Esta resolução entregou EXATAMENTE a conta pedida?" — e não apenas "alguma
// conta". A distinção é a defesa contra a escolha forjada: sem vínculo com a
// conta pedida, a resolução cai na derivação e pode devolver OUTRA conta;
// aceitar isso seria entrar num ambiente que a pessoa não escolheu.
//
// Vive aqui, ao lado da resolução, porque os três chamadores (guarda, página e
// Server Action) precisam fazer a MESMA pergunta — três cópias do mesmo `&&`
// eram três oportunidades de uma delas afrouxar.
// É type predicate para que o chamador que passou por ela possa usar
// `resolucao.usuario` sem re-testar o `tipo` — re-testar seria justamente a
// duplicação que esta função existe para eliminar.
export function resolveuAConta(
  resolucao: ResolucaoDeVinculo,
  contaId: string,
): resolucao is Extract<ResolucaoDeVinculo, { tipo: "resolvido" }> {
  return resolucao.tipo === "resolvido" && resolucao.usuario.contaId === contaId;
}

// Opções da tela de seleção (UX-DR12: nome da conta + perfil da pessoa NAQUELA
// conta). Sem `take`: aqui a lista inteira é o produto, ao contrário da
// resolução, que só precisa saber se há uma ou mais de uma.
//
// Sem parâmetro de status de propósito: é a MESMA lista que decide a
// ambiguidade (STATUS_ESCOLHIVEL). Um parâmetro aqui seria justamente a manopla
// que permitiria à tela oferecer um conjunto diferente do que a guarda contou.
//
// Devolve só o que a tela mostra — nunca o vínculo cru: a página não precisa
// de `perfilAcessoId`, `status` nem de nada que se pareça com autorização. O
// que ela oferece é palpite; quem decide é a revalidação no servidor (NFR2).
export async function listarOpcoesDeAmbiente(usuarioId: string) {
  const vinculos = await prisma.vinculoConta.findMany({
    where: ondeVinculoUtilizavel(usuarioId, STATUS_ESCOLHIVEL),
    include: { conta: true, perfilAcesso: true },
    // `contaId` como desempate: duas contas de mesmo nome — exatamente o caso
    // que a linha do perfil existe para desambiguar — sairiam em ordem não
    // determinística entre renders, e a pessoa poderia clicar numa conta
    // diferente da que leu.
    orderBy: [{ conta: { nome: "asc" } }, { contaId: "asc" }],
  });

  return vinculos.map((vinculo) => ({
    contaId: vinculo.contaId,
    contaNome: vinculo.conta.nome,
    perfilNome: vinculo.perfilAcesso.nome,
  }));
}

// A conta ativa vive na SESSÃO (`model Session`), que é tabela do nosso banco
// como qualquer outra — então a escrita é de repositório (AD-1), e não uma
// chamada ao Better Auth. Escrever pela sessão (e não pela identidade) é o que
// garante que dois navegadores da mesma pessoa possam estar em contas
// diferentes e que encerrar a sessão esqueça a escolha.
//
// Escreve sem validar: quem chama já revalidou o vínculo contra o banco
// (resolverUsuarioAutenticadoPeloVinculo com a conta escolhida). O `where`
// inclui `userId` mesmo assim — uma sessão só pode receber a conta ativa da
// própria identidade, e amarrar isso no `where` é mais barato do que confiar
// em quem chama.
export async function definirContaAtivaDaSessao(
  sessaoId: string,
  usuarioId: string,
  contaId: string,
) {
  return prisma.session.updateMany({
    where: { id: sessaoId, userId: usuarioId },
    data: { contaAtivaId: contaId },
  });
}

// Conta ativa que deixou de ser válida (vínculo desativado/removido, conta
// suspensa) é apagada da sessão em vez de derrubá-la: a pessoa volta à seleção
// se ainda tiver outro ambiente, e só cai no login quando não sobra nenhum.
//
// Mesmo `where` da função irmã, pelo mesmo motivo: uma sessão só é mexida pela
// própria identidade.
export async function limparContaAtivaDaSessao(sessaoId: string, usuarioId: string) {
  return prisma.session.updateMany({
    where: { id: sessaoId, userId: usuarioId },
    data: { contaAtivaId: null },
  });
}
