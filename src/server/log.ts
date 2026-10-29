import "server-only";

// Registro de falhas INESPERADAS do servidor (29-10-2026).
//
// O diferido da Story 4.1: as Server Actions envolviam a escrita num
// `catch (erro)` que devolvia uma mensagem genérica e descartava o erro. Do
// lado de fora, uma violação de regra de negócio e um banco fora do ar
// produziam exatamente a mesma resposta — e não ficava nada em lugar nenhum
// para dizer qual dos dois tinha acontecido. Um defeito de produção era
// invisível até alguém reclamar.
//
// O que este módulo NÃO é: observabilidade. O AD-7 prevê Sentry, que precisa
// de uma conta e de um DSN. Enquanto isso não existe, `console.error` em
// formato estável é o que a Vercel já coleta e o que permite procurar.
// Quando o Sentry entrar, é esta função que muda — não os 22 `catch`.
//
// Nunca registra o VALOR dos campos: o que identifica o caso é a operação e
// a conta, e um log de produção não é lugar para CPF, razão social ou
// qualquer coisa que a pessoa digitou.

export type ContextoDaFalha = {
  /// A operação, no formato "entidade.acao" (ex.: "emissao.criar"). Estável
  /// de propósito: é por ela que se procura no log.
  operacao: string;
  contaId?: string;
};

/// Chamada no `catch` genérico, imediatamente antes de devolver a mensagem
/// ao usuário. Não relança: a resposta ao usuário continua sendo a mesma, e
/// o objetivo aqui é só deixar rastro.
export function registrarFalha(contexto: ContextoDaFalha, erro: unknown): void {
  const detalhe =
    erro instanceof Error
      ? { tipo: erro.name, mensagem: erro.message, pilha: erro.stack }
      : { tipo: typeof erro, mensagem: String(erro) };

  // Uma linha, JSON, prefixo fixo — é o que torna o log procurável sem
  // ferramenta nenhuma.
  console.error(
    "[raiz:falha]",
    JSON.stringify({
      operacao: contexto.operacao,
      contaId: contexto.contaId ?? null,
      quando: new Date().toISOString(),
      ...detalhe,
    }),
  );
}
