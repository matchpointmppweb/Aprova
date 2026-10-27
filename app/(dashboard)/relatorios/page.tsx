import type { Metadata } from "next";

import {
  CATEGORIAS_DE_RELATORIO,
  CATEGORIA_PADRAO,
  RELATORIOS,
  interpretarPeriodo,
  isCategoriaDeRelatorio,
  montarAtivosPorRevisao,
  montarEmissoesPorAtivo,
  montarItensPendentes,
  montarPessoas,
  montarServicosPorPessoa,
  type CategoriaDeRelatorio,
  type Periodo,
  type TabelaDoRelatorio,
} from "@/src/lib/relatorios";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import {
  ativosComUltimaEmissao,
  emissoesComServicos,
  itensPendentes,
  lancamentosDeServico,
  pessoasDoRelatorio,
} from "@/src/server/repositories/relatorio";

export const metadata: Metadata = {
  title: "Relatórios — Raiz",
};

// Aba RELATÓRIOS (C3, 27-10-2026).
//
// Server Component puro, com um `<form method="get">` — nenhum JavaScript de
// cliente. A categoria e o período viajam na URL, o que dá de graça o que
// uma tela de relatório mais precisa: o link é compartilhável, o botão
// voltar funciona e recarregar não perde o filtro.
//
// SEM can(): não existe ação "ver" no enum `Modulo` (só criar/editar/
// excluir) e nenhuma leitura do projeto a inventa — /ativos, /pessoas e
// /emissao são igualmente abertas a quem está na conta. Criar um módulo
// `relatorios` com três flags de escrita para uma tela que só lê seria um
// mecanismo pela metade. Restringir leitura, se um dia for preciso, é
// decisão para o sistema INTEIRO, não para esta tela. O que protege aqui é o
// mesmo do resto: sessão autenticada e `where` por contaId (AD-1).
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const usuarioSessao = await exigirUsuarioAutenticado();
  const parametros = await searchParams;

  const categoria = lerCategoria(parametros.categoria);
  const definicao = RELATORIOS[categoria];

  const deBruto = lerTexto(parametros.de);
  const ateBruto = lerTexto(parametros.ate);
  const leitura = interpretarPeriodo(deBruto, ateBruto);

  // Período inválido RECUSA e não gera o relatório (NFR7/AD-30): mostrar uma
  // tabela "sem filtro" ao lado de datas que a pessoa digitou seria pior que
  // não mostrar nada — ela leria os números como se fossem do período dela.
  // O mockup não cobre esta tela; o erro aparece no campo, nunca em alert().
  const erro = leitura.ok ? null : leitura.erro;
  // Relatório de fotografia ignora o período de propósito, e a tela não
  // oferece os campos — ver `usaPeriodo`.
  const periodo: Periodo =
    leitura.ok && definicao.usaPeriodo ? leitura.periodo : { de: null, ate: null };

  const tabela = erro ? null : await carregar(categoria, usuarioSessao.contaId, periodo);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / <b>Relatórios</b>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>{definicao.titulo}</h3>
            <p className="rel-sub">{definicao.descricao}</p>
          </div>
        </div>

        <form className="rel-filtros" method="get">
          <div className="f">
            <label htmlFor="rel-categoria">Relatório</label>
            <select id="rel-categoria" name="categoria" defaultValue={categoria}>
              {CATEGORIAS_DE_RELATORIO.map((chave) => (
                <option key={chave} value={chave}>
                  {RELATORIOS[chave].titulo}
                </option>
              ))}
            </select>
          </div>

          {definicao.usaPeriodo ? (
            <>
              <div className="f">
                <label htmlFor="rel-de">De</label>
                <input id="rel-de" name="de" type="date" defaultValue={deBruto} />
              </div>
              <div className="f">
                <label htmlFor="rel-ate">Até</label>
                <input id="rel-ate" name="ate" type="date" defaultValue={ateBruto} />
              </div>
            </>
          ) : null}

          <button className="btn btn-primary" type="submit">
            Gerar
          </button>
        </form>

        {erro ? <p className="field-error rel-erro">{erro}</p> : null}

        {definicao.usaPeriodo && !erro ? (
          <p className="rel-aviso">
            O período filtra pela <b>data da emissão</b>. Lançamentos por horas não têm data
            própria, então seguem a data da emissão a que pertencem.
          </p>
        ) : null}

        {tabela ? <TabelaRelatorio tabela={tabela} /> : null}
      </div>
    </section>
  );
}

function TabelaRelatorio({ tabela }: { tabela: TabelaDoRelatorio }) {
  if (tabela.linhas.length === 0) {
    return <p className="rel-vazio">Nenhum resultado para este filtro.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {tabela.colunas.map((coluna) => (
              <th key={coluna.chave} className={coluna.numerica ? "rel-num" : undefined}>
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((linha, indice) => (
            // O índice como key é seguro aqui e só aqui: a tabela é
            // read-only, gerada inteira a cada request, sem reordenação nem
            // edição de linha no cliente — não há estado por linha para
            // embaralhar.
            <tr data-row key={indice}>
              {tabela.colunas.map((coluna) => (
                <td key={coluna.chave} className={coluna.numerica ? "rel-num" : undefined}>
                  {linha[coluna.chave]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {tabela.total ? (
          <tfoot>
            <tr>
              {tabela.colunas.map((coluna) => (
                <td key={coluna.chave} className={coluna.numerica ? "rel-num" : undefined}>
                  {tabela.total?.[coluna.chave] ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      <div className="table-foot">
        <span>
          {tabela.linhas.length} {tabela.linhas.length === 1 ? "linha" : "linhas"}
        </span>
      </div>
    </div>
  );
}

function lerTexto(valor: string | string[] | undefined): string {
  // `?de=1&de=2` chega como array — fica com o primeiro em vez de virar
  // "1,2", que não casaria com nenhum formato e viraria erro de campo.
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

// Categoria desconhecida na URL cai no padrão em silêncio, sem erro: é link
// velho ou URL digitada à mão, não entrada de formulário, e não há o que a
// pessoa possa corrigir num campo.
function lerCategoria(valor: string | string[] | undefined): CategoriaDeRelatorio {
  const bruto = lerTexto(valor);
  return isCategoriaDeRelatorio(bruto) ? bruto : CATEGORIA_PADRAO;
}

async function carregar(
  categoria: CategoriaDeRelatorio,
  contaId: string,
  periodo: Periodo,
): Promise<TabelaDoRelatorio> {
  switch (categoria) {
    case "servicos-por-pessoa": {
      const linhas = await lancamentosDeServico(contaId, periodo);
      return montarServicosPorPessoa(
        linhas.map((linha) => ({
          modo: linha.modo,
          duracaoMinutos: linha.duracaoMinutos,
          inicio: linha.inicio,
          fim: linha.fim,
          pessoaId: linha.pessoa.id,
          pessoaNome: linha.pessoa.nome,
          cargo: linha.pessoa.cargo.descricao,
        })),
      );
    }
    case "emissoes-por-ativo": {
      const emissoes = await emissoesComServicos(contaId, periodo);
      return montarEmissoesPorAtivo(
        emissoes.map((emissao) => ({
          ativoId: emissao.ativo.id,
          ativoCodigo: emissao.ativo.codigo,
          ativoNome: emissao.ativo.nome,
          status: emissao.status,
          servicos: emissao.servicos,
        })),
      );
    }
    case "itens-pendentes": {
      const pendentes = await itensPendentes(contaId, periodo);
      return montarItensPendentes(
        pendentes.map((pendente) => ({
          emissaoCodigo: pendente.emissao.codigo,
          emissaoStatus: pendente.emissao.status,
          dataEmissao: pendente.emissao.dataEmissao,
          ativoCodigo: pendente.emissao.ativo.codigo,
          ativoNome: pendente.emissao.ativo.nome,
          item: pendente.itemRevisional.nome,
          categoria: pendente.itemRevisional.categoria,
          observacao: pendente.observacao,
        })),
      );
    }
    case "ativos-por-revisao": {
      const ativos = await ativosComUltimaEmissao(contaId);
      return montarAtivosPorRevisao(
        ativos.map((ativo) => ({
          codigo: ativo.codigo,
          nome: ativo.nome,
          tipo: ativo.tipoAtivo.nome,
          empresa: ativo.empresa?.razaoSocial ?? null,
          localizacao: ativo.localizacao,
          status: ativo.status,
          totalDeEmissoes: ativo._count.emissoes,
          ultimaEmissao: ativo.emissoes[0]
            ? {
                codigo: ativo.emissoes[0].codigo,
                dataEmissao: ativo.emissoes[0].dataEmissao,
              }
            : null,
        })),
      );
    }
    case "pessoas": {
      const pessoas = await pessoasDoRelatorio(contaId);
      return montarPessoas(
        pessoas.map((pessoa) => ({
          nome: pessoa.nome,
          cpf: pessoa.cpf,
          cargo: pessoa.cargo.descricao,
          funcao: pessoa.funcao.descricao,
          lancamentos: pessoa._count.servicosEmissao,
        })),
      );
    }
  }
}
