import "server-only";

import { prisma } from "@/src/server/repositories/db";

/**
 * Contenção de força bruta em login e recuperação de senha.
 *
 * Adiado desde a Story 1.1 com a ressalva de que "a severidade real depende de
 * exposição pública" — condição que se cumpriu quando o app foi ao ar.
 *
 * DUAS CHAVES, sempre as duas juntas, porque cada uma cobre o que a outra
 * deixa passar:
 *   - por E-MAIL contém o ataque dirigido a uma conta específica;
 *   - por IP contém a pulverização — uma senha comum tentada contra centenas
 *     de e-mails diferentes nunca encostaria no limite por e-mail.
 *
 * FALHA ABERTA de propósito: se o banco estiver indisponível, o limitador
 * deixa passar em vez de barrar. É a escolha certa para um limitador — o dano
 * de trancar todo mundo fora do sistema por um problema de infraestrutura é
 * maior e mais provável que o de uma janela sem contenção. A autenticação em
 * si continua fechada; o que falha aberto é a CONTAGEM, nunca a senha.
 */

export type TipoDeTentativa = "login" | "reset";

type Limite = { janelaEmMinutos: number; maximoPorEmail: number; maximoPorIp: number };

// Números escolhidos para serem invisíveis a quem erra a senha de verdade e
// intransponíveis para quem adivinha. Dez tentativas em quinze minutos cobre
// com folga o caso "não lembro qual das minhas senhas é"; um atacante, no mesmo
// ritmo, leva anos para varrer um espaço de senhas relevante.
//
// O limite de recuperação é mais apertado porque cada tentativa dispara um
// e-mail: sem ele, o formulário vira ferramenta de inundar a caixa de alguém.
const LIMITES: Record<TipoDeTentativa, Limite> = {
  login: { janelaEmMinutos: 15, maximoPorEmail: 10, maximoPorIp: 30 },
  reset: { janelaEmMinutos: 60, maximoPorEmail: 5, maximoPorIp: 15 },
};

function chaveDeEmail(email: string) {
  return `email:${email.trim().toLowerCase()}`;
}

function chaveDeIp(ip: string) {
  return `ip:${ip}`;
}

/**
 * Extrai o IP de quem chamou a partir dos cabeçalhos do proxy.
 *
 * `x-forwarded-for` é uma LISTA, e o cliente pode forjar entradas. Quem se
 * pode confiar é o último salto — o proxy da plataforma, que acrescenta o IP
 * real ao FIM. A Vercel também expõe `x-real-ip`, já resolvido, e ele tem
 * precedência por não exigir essa interpretação.
 *
 * Sem IP identificável, devolve null e o limite por IP simplesmente não se
 * aplica — o limite por e-mail continua valendo.
 */
export function ipDosCabecalhos(cabecalhos: Headers): string | null {
  const real = cabecalhos.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }

  const encaminhado = cabecalhos.get("x-forwarded-for");
  if (!encaminhado) {
    return null;
  }

  const partes = encaminhado
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean);

  return partes.at(-1) ?? null;
}

async function contarFalhas(
  tipo: TipoDeTentativa,
  chave: string,
  desde: Date,
): Promise<number> {
  return prisma.tentativaDeAcesso.count({
    where: { tipo, chave, criadoEm: { gte: desde } },
  });
}

/**
 * "Esta tentativa pode prosseguir?" — consultada ANTES de verificar a senha,
 * para que o custo de uma tentativa bloqueada seja uma contagem indexada, e
 * não o hash da senha (que é caro de propósito e viraria o próprio vetor de
 * ataque).
 */
export async function tentativaPermitida(
  tipo: TipoDeTentativa,
  email: string,
  ip: string | null,
): Promise<boolean> {
  const limite = LIMITES[tipo];
  const desde = new Date(Date.now() - limite.janelaEmMinutos * 60 * 1000);

  try {
    const [porEmail, porIp] = await Promise.all([
      contarFalhas(tipo, chaveDeEmail(email), desde),
      ip ? contarFalhas(tipo, chaveDeIp(ip), desde) : Promise.resolve(0),
    ]);

    return porEmail < limite.maximoPorEmail && porIp < limite.maximoPorIp;
  } catch {
    // Falha aberta: ver o cabeçalho deste arquivo.
    return true;
  }
}

/** Registra UMA falha, nas duas chaves. Só falhas entram. */
export async function registrarFalha(
  tipo: TipoDeTentativa,
  email: string,
  ip: string | null,
): Promise<void> {
  const linhas = [{ tipo, chave: chaveDeEmail(email) }];
  if (ip) {
    linhas.push({ tipo, chave: chaveDeIp(ip) });
  }

  try {
    await prisma.tentativaDeAcesso.createMany({ data: linhas });
  } catch {
    // Não registrar é ruim; impedir o login por causa disso seria pior.
  }
}

/**
 * Sucesso zera o histórico DAQUELE e-mail — nunca o do IP.
 *
 * A assimetria é deliberada: um atacante com acesso a uma conta qualquer
 * poderia, senão, limpar a própria cota de IP a cada acerto e seguir
 * pulverizando indefinidamente.
 */
export async function limparFalhas(
  tipo: TipoDeTentativa,
  email: string,
): Promise<void> {
  try {
    await prisma.tentativaDeAcesso.deleteMany({
      where: { tipo, chave: chaveDeEmail(email) },
    });
  } catch {
    // Melhor esforço: o pior efeito é a pessoa carregar falhas antigas até a
    // janela expirar sozinha.
  }
}

/**
 * Descarta tentativas velhas demais para influenciar qualquer limite.
 *
 * Não há tarefa agendada no projeto, então a limpeza é oportunista: roda junto
 * de uma falha ocasional, no caminho que já é lento por natureza. Sem ela a
 * tabela cresceria para sempre.
 */
export async function limparTentativasAntigas(): Promise<void> {
  const maiorJanela = Math.max(
    ...Object.values(LIMITES).map((limite) => limite.janelaEmMinutos),
  );
  const corte = new Date(Date.now() - maiorJanela * 60 * 1000);

  try {
    await prisma.tentativaDeAcesso.deleteMany({
      where: { criadoEm: { lt: corte } },
    });
  } catch {
    // Manutenção: nunca afeta o desfecho de uma autenticação.
  }
}
