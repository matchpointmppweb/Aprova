import { PrismaClient, Modulo } from "@prisma/client";
import type { StatusUsuario, StatusConta } from "@prisma/client";

// Client próprio dos testes. NÃO é o singleton de `repositories/db.ts` — ele
// também existe no processo (o código sob teste o usa) e os dois apontam para o
// mesmo banco efêmero. Este aqui serve para MONTAR e INSPECIONAR estado, para
// que um defeito no código sob teste não possa mascarar a si mesmo escrevendo e
// lendo pela mesma função.
export const db = new PrismaClient();

// Ordem importa: filhos antes de pais. `TRUNCATE ... CASCADE` numa tacada só
// seria mais curto, mas apagaria em silêncio tabelas que um teste esqueceu de
// declarar — e o objetivo aqui é que adicionar um modelo novo sem limpar dê erro
// visível, não um teste que passa por acaso.
export async function limparBanco() {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "tentativas_de_acesso", "trocas_de_conta", "sessoes", "contas_de_login", "verificacoes",
      "servicos_emissao", "itens_executados_emissao", "emissoes",
      "plano_itens_revisionais", "planos_revisionais", "itens_revisionais",
      "ativos", "tipos_de_ativo",
      "pessoas", "funcoes", "cargos", "empresas", "locais",
      "permissoes_de_modulo", "vinculos_de_conta", "perfis_de_acesso",
      "usuarios", "contas"
    RESTART IDENTITY CASCADE
  `);
}

let contador = 0;
function unico() {
  contador += 1;
  return `${Date.now().toString(36)}-${contador}`;
}

export async function criarConta(
  opcoes: { nome?: string; status?: StatusConta } = {},
) {
  const sufixo = unico();
  return db.conta.create({
    data: {
      nome: opcoes.nome ?? `Conta ${sufixo}`,
      cnpj: `${sufixo}`.padEnd(18, "0").slice(0, 18),
      ...(opcoes.status ? { status: opcoes.status } : {}),
    },
  });
}

/// Perfil com permissão TOTAL ou NENHUMA em todos os módulos configuráveis.
/// Os testes que precisam de granularidade montam as permissões explicitamente.
export async function criarPerfil(
  contaId: string,
  opcoes: { nome?: string; permitirTudo?: boolean } = {},
) {
  const modulos = Object.values(Modulo);
  const permitir = opcoes.permitirTudo ?? true;

  return db.perfilAcesso.create({
    data: {
      contaId,
      nome: opcoes.nome ?? `Perfil ${unico()}`,
      permissoes: {
        create: modulos.map((modulo) => ({
          modulo,
          criar: permitir,
          editar: permitir,
          excluir: permitir,
        })),
      },
    },
  });
}

export async function criarIdentidade(
  opcoes: {
    nome?: string;
    email?: string;
    status?: StatusUsuario;
    isPlataformaOperador?: boolean;
  } = {},
) {
  return db.usuario.create({
    data: {
      nome: opcoes.nome ?? `Identidade ${unico()}`,
      email: opcoes.email ?? `pessoa-${unico()}@teste.local`,
      status: opcoes.status ?? "Ativo",
      isPlataformaOperador: opcoes.isPlataformaOperador ?? false,
    },
  });
}

export async function criarVinculo(
  usuarioId: string,
  contaId: string,
  perfilAcessoId: string,
  opcoes: { nome?: string; status?: StatusUsuario } = {},
) {
  return db.vinculoConta.create({
    data: {
      usuarioId,
      contaId,
      perfilAcessoId,
      nome: opcoes.nome ?? `Nome na conta ${unico()}`,
      status: opcoes.status ?? "Ativo",
    },
  });
}

/// Conta completa: conta + perfil com tudo liberado + identidade + vínculo
/// Ativo. É o arranjo de partida da maioria dos testes.
export async function criarAmbiente(
  opcoes: { nomeDaConta?: string; nomeNaConta?: string; email?: string } = {},
) {
  const conta = await criarConta({ nome: opcoes.nomeDaConta });
  const perfil = await criarPerfil(conta.id, { nome: "Administrador" });
  const identidade = await criarIdentidade({ email: opcoes.email });
  const vinculo = await criarVinculo(identidade.id, conta.id, perfil.id, {
    nome: opcoes.nomeNaConta,
  });

  return { conta, perfil, identidade, vinculo };
}

export async function criarSessao(usuarioId: string, contaAtivaId?: string) {
  return db.session.create({
    data: {
      token: `token-${unico()}`,
      userId: usuarioId,
      contaAtivaId: contaAtivaId ?? null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}
