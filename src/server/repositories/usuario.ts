import "server-only";

// `Prisma` entra como valor (não só como tipo) para reconhecer o P2025 de uma
// escrita cujo alvo sumiu em paralelo.
import { Prisma } from "@prisma/client";
import type { StatusUsuario } from "@prisma/client";

import { prisma } from "./db";

// Permite que chamadores (Server Actions) passem um `tx` de
// prisma.$transaction em vez do client global — usado pela guarda de
// "último Administrador" em editarUsuarioAction, que precisa ler a contagem
// de admins e escrever a atualização na mesma transação para ser atômica
// contra autoedições concorrentes.
type ExecutorPrisma = typeof prisma | Prisma.TransactionClient;

// O Prisma não tem transação aninhada: quando o chamador já passou um `tx`,
// reutilizamos esse tx; só quando o executor é um client capaz de abrir
// transação é que abrimos uma nossa. A discriminação é por capacidade, não por
// identidade de referência (`db === prisma`): qualquer outro PrismaClient
// legítimo também precisa do ramo transacional, e Prisma.TransactionClient é
// justamente o tipo que não expõe `$transaction`.
//
// O dual-write da Story 6.1 morreu com as colunas (não há mais dois lados a
// sincronizar), mas o helper continua necessário: uma edição ainda lê o
// vínculo e escreve depois, e as duas metades precisam do mesmo instante.
function emTransacao<T>(
  db: ExecutorPrisma,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in db) {
    return db.$transaction(fn);
  }
  return fn(db);
}

// Única via de leitura/escrita de Usuario (AD-1).
//
// Story 6.3 (fase contract): `Usuario` não tem mais `contaId` nem
// `perfilAcessoId`. Toda leitura/escrita escopada por conta passa pelo
// VinculoConta — ele é a única fonte de "esta pessoa pertence a esta conta,
// com este perfil e com este status por lá". O dual-write da Story 6.1 e o
// helper `emTransacao` que o sustentava deixaram de existir junto com as
// colunas: não há mais dois lados a sincronizar.
//
// A divisão de responsabilidade entre as duas tabelas é fixa:
//   - identidade (`usuarios`): nome, e-mail (único global), ultimoAcesso,
//     status GLOBAL (concluiu o primeiro acesso / banida da plataforma) e
//     isPlataformaOperador;
//   - vínculo (`vinculos_de_conta`): conta, perfil de acesso e status NAQUELA
//     conta.
//
// `contaId` chega aqui já resolvido pelo vínculo da sessão autenticada
// (src/server/repositories/vinculo-conta.ts), nunca de input do cliente.

// `ultimoAcesso` é da IDENTIDADE, não do vínculo — a pergunta que a coluna
// responde ("quando esta pessoa entrou pela última vez") não tem recorte por
// conta. Por isso a função deixou de receber `contaId`: não havia mais o que
// filtrar, e um parâmetro ignorado se pareceria com um isolamento que não
// acontece.
export async function registrarUltimoAcesso(usuarioId: string) {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { ultimoAcesso: new Date() },
  });
}

// Listagem da tela Usuários (Story 1.2) e origem única do seletor de
// responsável de Planos e de Emissão, além da validação
// `vinculoEResponsavelValidos` (AD-25).
//
// A ASSINATURA e a FORMA do retorno são deliberadamente as mesmas de antes da
// Story 6.3 — é isso que mantém app/(dashboard)/{usuarios,planos-revisionais,
// emissao}/page.tsx e src/server/actions/{plano,emissao}.ts intactos. O que
// mudou é a origem: consulta os VÍNCULOS da conta, não mais `Usuario.contaId`.
//
// Duas escolhas explícitas sobre o que sai daqui:
//   - `perfilAcesso` é o do VÍNCULO (o mesmo perfil que can() aplica naquela
//     conta), não um atributo da identidade — que não tem mais perfil nenhum;
//   - `status` é o do VÍNCULO, sobrescrevendo o status global vindo do spread.
//     É o status daquela conta que a tela de Usuários mostra, filtra e edita,
//     e é ele que o FR24 encerra ao remover alguém de uma conta.
//
// NÃO filtra por `status`: a tela de Usuários lista e filtra os três estados
// (Ativo/Convite pendente/Inativo) do lado do cliente, e quem foi desativado
// precisa continuar aparecendo para poder ser reativado. "Vínculo ativo na
// conta" aqui é o vínculo VIGENTE — quem não tem vínculo nenhum com a conta é
// que nunca aparece (NFR2).
export async function listarUsuarios(contaId: string) {
  const vinculos = await prisma.vinculoConta.findMany({
    where: { contaId },
    include: {
      usuario: true,
      perfilAcesso: { select: { id: true, nome: true } },
    },
    orderBy: { usuario: { nome: "asc" } },
  });

  return vinculos.map((vinculo) => ({
    ...vinculo.usuario,
    status: vinculo.status,
    perfilAcesso: vinculo.perfilAcesso,
  }));
}

// Convite: cria a identidade e o vínculo JUNTOS, no mesmo nested create —
// atômico por natureza, sem $transaction explícito (mesmo padrão de
// criarPerfilAcesso/seed.ts): falha em qualquer lado reverte os dois. Nenhuma
// linha em Account — a senha só existe depois que o convidado passa pelo mesmo
// fluxo de definição de senha do Better Auth (auth.api.requestPasswordReset),
// em src/server/actions/usuario.ts.
//
// `perfilAcessoId` vive SÓ no vínculo (Story 6.3). O `status` da identidade
// nasce ConvitePendente porque ela ainda não concluiu o primeiro acesso; o do
// vínculo, porque o convite para ESTA conta ainda não foi aceito.
export async function criarUsuarioConvidado(
  contaId: string,
  dados: { nome: string; email: string; perfilAcessoId: string },
) {
  return prisma.usuario.create({
    data: {
      nome: dados.nome,
      email: dados.email,
      status: "ConvitePendente",
      vinculos: {
        create: {
          contaId,
          perfilAcessoId: dados.perfilAcessoId,
          status: "ConvitePendente",
        },
      },
    },
  });
}

// Edição pela tela de Usuários. Os campos se dividem entre as duas tabelas
// (Story 6.3): `nome`/`email` são da identidade, `perfilAcessoId`/`status` são
// do vínculo daquela conta.
//
// Retorna false (sem lançar) se a pessoa não tiver vínculo com esta conta,
// para a Server Action decidir como responder sem expor detalhe interno — e,
// nesse caso, NADA é escrito: o vínculo é o que dá o escopo multi-tenant desta
// operação (AD-1), no lugar do antigo `where: { id, contaId }`.
//
// **Campos de identidade são recusados para quem tem mais de um vínculo.** A
// identidade agora atravessa contas: escrever `email` a partir da conta A
// mudaria o LOGIN de alguém que também pertence à conta B e que, somado ao
// fluxo de definição de senha, entregaria a conta dessa pessoa ao
// administrador de A. Como não há tela que arbitre isso antes da Story 6.4/6.6,
// a recusa é fail-closed: multivínculo => só `perfilAcessoId`/`status` (que são
// do vínculo, sempre escopados a ESTA conta) passam; uma tentativa real de
// mudar `nome`/`email` devolve false, sem escrever nada. Reenviar os mesmos
// valores não é tentativa de alteração — o formulário sempre manda os quatro
// campos — e segue adiante.
//
// Leitura e escrita rodam sempre na MESMA transação: o chamador
// (editarUsuarioAction) abre uma Serializable para a guarda de último
// Administrador e passa o `tx`; quando ninguém passa, abrimos uma aqui — sem
// isso, a checagem do vínculo e a escrita seriam dois instantes distintos.
export async function atualizarUsuario(
  contaId: string,
  usuarioId: string,
  dados: Partial<{
    nome: string;
    email: string;
    perfilAcessoId: string;
    status: StatusUsuario;
  }>,
  db: ExecutorPrisma = prisma,
) {
  return emTransacao(db, async (tx) => {
    const vinculos = await tx.vinculoConta.findMany({
      where: { usuarioId },
      select: { id: true, contaId: true },
    });
    const vinculo = vinculos.find((atual) => atual.contaId === contaId);
    if (!vinculo) {
      return false;
    }

    const camposDaIdentidade: Prisma.UsuarioUpdateInput = {};
    if (dados.nome !== undefined || dados.email !== undefined) {
      const identidade = await tx.usuario.findUniqueOrThrow({
        where: { id: usuarioId },
        select: { nome: true, email: true },
      });
      const alteraIdentidade =
        (dados.nome !== undefined && dados.nome !== identidade.nome) ||
        (dados.email !== undefined && dados.email !== identidade.email);

      if (alteraIdentidade && vinculos.length > 1) {
        return false;
      }
      if (dados.nome !== undefined) camposDaIdentidade.nome = dados.nome;
      if (dados.email !== undefined) camposDaIdentidade.email = dados.email;
    }

    const camposDoVinculo: Prisma.VinculoContaUpdateWithoutUsuarioInput = {};
    if (dados.perfilAcessoId !== undefined) {
      camposDoVinculo.perfilAcesso = { connect: { id: dados.perfilAcessoId } };
    }
    if (dados.status !== undefined) camposDoVinculo.status = dados.status;

    try {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          ...camposDaIdentidade,
          ...(Object.keys(camposDoVinculo).length > 0
            ? { vinculos: { update: { where: { id: vinculo.id }, data: camposDoVinculo } } }
            : {}),
        },
      });
    } catch (erro) {
      // P2025 = a identidade ou o vínculo sumiu entre a leitura e a escrita
      // (alguém removeu a pessoa da conta em paralelo). É exatamente o caso
      // "usuário sem vínculo nesta conta" — false, e não erro genérico.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === "P2025"
      ) {
        return false;
      }
      throw erro;
    }

    return true;
  });
}

// Primeiro login de um convidado (I/O Matrix da Story 1.2):
// ConvitePendente -> Ativo. Idempotente — chamar de novo para quem já está
// Ativo dos dois lados repete o mesmo resultado.
//
// A promoção converge os DOIS lados (Story 6.2): a leitura de acesso exige
// `Ativo` na identidade E no vínculo, então deixar um deles para trás
// significaria login bem-sucedido seguido de expulsão na requisição seguinte.
// Identidade já `Ativo` com vínculo ainda `ConvitePendente` é estado real (e
// rotineiro a partir da 6.6, quando uma pessoa já ativa numa conta é convidada
// para outra).
//
// `count` responde à pergunta que o chamador realmente faz: "a pessoa terminou
// esta chamada podendo entrar?". 1 = identidade e vínculo Ativos; 0 = não
// promovida (sem vínculo com esta conta, ou Inativo de algum dos lados — um
// Inativo nunca é promovido por uma chamada solta desta função).

// Aborta a transação de ativarUsuarioConvidado quando a identidade é desativada
// entre a leitura e a escrita — desfaz a promoção parcial do vínculo, sem virar
// erro para o chamador (que recebe { count: 0 } como em qualquer outra recusa).
class PromocaoConcorrenteError extends Error {}
export async function ativarUsuarioConvidado(usuarioId: string, contaId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const vinculo = await tx.vinculoConta.findUnique({
        where: { usuarioId_contaId: { usuarioId, contaId } },
        select: { status: true, usuario: { select: { status: true } } },
      });

      if (!vinculo || vinculo.status === "Inativo" || vinculo.usuario.status === "Inativo") {
        return { count: 0 };
      }

      // Compare-and-set: o `status` continua no WHERE das duas escritas, não
      // só na leitura acima. Sem isso, um administrador que desativasse a
      // pessoa entre a leitura e a escrita teria a desativação revertida em
      // silêncio por um login concorrente.
      const vinculoPromovido = await tx.vinculoConta.updateMany({
        where: { usuarioId, contaId, status: { not: "Inativo" } },
        data: { status: "Ativo" },
      });
      if (vinculoPromovido.count === 0) {
        return { count: 0 };
      }

      const identidadePromovida = await tx.usuario.updateMany({
        where: { id: usuarioId, status: { not: "Inativo" } },
        data: { status: "Ativo" },
      });
      if (identidadePromovida.count === 0) {
        // Identidade banida entre a leitura e esta escrita: o vínculo acabou de
        // ser promovido e não pode ficar assim. Abortar a transação desfaz a
        // promoção — devolver { count: 0 } daqui a deixaria gravada.
        throw new PromocaoConcorrenteError();
      }

      return { count: 1 };
    });
  } catch (erro) {
    if (erro instanceof PromocaoConcorrenteError) {
      return { count: 0 };
    }
    throw erro;
  }
}

// Sustenta a guarda de "último Administrador" (Intent da Story 1.2): conta as
// pessoas que de fato podem administrar ESTA conta agora.
//
// Story 6.3: a contagem é por VÍNCULO — é ele que carrega o perfil de acesso e
// o status por conta. A identidade também precisa estar `Ativo` porque o
// acesso exige `Ativo` nos dois lados; contar alguém banido da plataforma como
// administrador ativo deixaria a conta ficar sem nenhum.
export async function contarAdministradoresAtivos(
  contaId: string,
  db: ExecutorPrisma = prisma,
) {
  return db.vinculoConta.count({
    where: {
      contaId,
      status: "Ativo",
      perfilAcesso: { nome: "Administrador" },
      usuario: { status: "Ativo" },
    },
  });
}
