// O TETO de concessão de permissões (29-10-2026).
//
// O buraco que isto fecha: nada impedia que um perfil com `editar` no módulo
// `perfil` concedesse a si mesmo — ou a outro perfil — qualquer permissão do
// sistema. Quem administra papéis virava administrador total em dois cliques,
// sem deixar rastro de escalada: a gravação é legítima, o resultado não.
//
// A regra é a clássica de RBAC: ninguém concede o que não tem. O ator pode
// distribuir qualquer subconjunto das PRÓPRIAS permissões, e nada além.
//
// Módulo puro (sem Prisma), para a tela poder desabilitar exatamente os
// mesmos checkboxes que o servidor recusa.

export type AcaoDePermissao = "criar" | "editar" | "excluir";

export const ACOES: readonly AcaoDePermissao[] = ["criar", "editar", "excluir"];

export type PermissaoDeModulo = {
  modulo: string;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
};

export const ERRO_ACIMA_DO_TETO =
  "Você não pode conceder uma permissão que o seu próprio perfil não tem.";

/// O que o ator pode conceder, por módulo. Um módulo AUSENTE do mapa é
/// tratado como "nenhuma permissão" — negar por omissão, nunca liberar,
/// é o mesmo critério de `can()` quando a linha de permissão não existe.
export function tetoDoAtor(
  permissoesDoAtor: readonly PermissaoDeModulo[],
): Map<string, PermissaoDeModulo> {
  return new Map(permissoesDoAtor.map((permissao) => [permissao.modulo, permissao]));
}

/// Devolve um erro por CHECKBOX que excede o teto — não um erro só para a
/// tela inteira. O `field` casa com o nome do input (`perm-{modulo}-{acao}`),
/// que é o que permite marcar a caixa exata em vez de mandar a pessoa
/// procurar numa matriz de oito módulos por três ações.
export function permissoesAcimaDoTeto(
  solicitadas: readonly PermissaoDeModulo[],
  permissoesDoAtor: readonly PermissaoDeModulo[],
  /// O que o perfil-alvo JÁ tem gravado — vazio na criação. O teto limita
  /// CONCEDER, não MANTER: sem esta exceção, um perfil restrito que abrisse
  /// um perfil mais poderoso e salvasse sem mexer em nada receberia erro em
  /// cada caixa que não é dele, tornando o alvo ineditável para ele. É o
  /// mesmo defeito que `src/lib/selecionavel.ts` evita com `atualId`.
  jaConcedidas: readonly PermissaoDeModulo[] = [],
): { field: string; message: string }[] {
  const teto = tetoDoAtor(permissoesDoAtor);
  const atuais = tetoDoAtor(jaConcedidas);
  const erros: { field: string; message: string }[] = [];

  for (const pedida of solicitadas) {
    const permitida = teto.get(pedida.modulo);
    const jaTinha = atuais.get(pedida.modulo);
    for (const acao of ACOES) {
      // Só CONCEDER é limitado. Tirar uma permissão que o ator não tem é
      // sempre aceito: reduzir o alcance de outro perfil nunca aumenta o
      // dele, e bloquear isso impediria um perfil restrito de corrigir um
      // excesso que ele mesmo enxerga.
      if (!pedida[acao]) continue;
      if (permitida?.[acao]) continue;
      // Já estava lá antes desta edição: manter não é conceder.
      if (jaTinha?.[acao]) continue;
      erros.push({
        field: `perm-${pedida.modulo}-${acao}`,
        message: ERRO_ACIMA_DO_TETO,
      });
    }
  }

  return erros;
}
