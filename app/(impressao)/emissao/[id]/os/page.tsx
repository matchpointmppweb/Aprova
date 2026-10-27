import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BotaoImprimir } from "@/src/components/emissao/botao-imprimir";
import { formatarDia, formatarInstante } from "@/src/lib/datas";
import { DURACAO_INVALIDA, formatarMinutos } from "@/src/lib/duracao";
import {
  minutosDoServicoGravado,
  rotuloDoGrupo,
  secoesDaOS,
  totalDeMinutosGravados,
  type ItemDaOS,
} from "@/src/lib/ordem-de-servico";
import { LABEL_POR_SETOR } from "@/src/server/actions/emissao-estado";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { buscarEmissaoParaImpressao } from "@/src/server/repositories/emissao";

export const metadata: Metadata = {
  title: "Ordem de Serviço — Raiz",
};

// ORDEM DE SERVIÇO IMPRESSA (C2, 27-10-2026).
//
// Rota PRÓPRIA, fora do grupo (dashboard), de propósito: o layout do
// dashboard monta topbar + sidebar + .main, e nada disso deve existir numa
// folha de papel. Aqui só o layout raiz se aplica (fontes e globals.css),
// então a página nasce limpa em vez de esconder a casca com CSS.
//
// A OS sai PREENCHIDA — comprovante do que foi executado (decisão de Fulvi em
// 27-10-2026), não formulário em branco.
//
// Sem can(): não existe ação "ver" no enum de permissões (só criar/editar/
// excluir) e nenhuma leitura do projeto a inventa. O que protege esta rota é
// o mesmo que protege a listagem — sessão autenticada e `where` por contaId
// (AD-1): o id de uma emissão de outra conta simplesmente não é encontrado e
// cai em notFound(), indistinguível de um id inexistente.
export default async function OrdemDeServicoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuarioSessao = await exigirUsuarioAutenticado();

  const emissao = await buscarEmissaoParaImpressao(usuarioSessao.contaId, id);
  if (!emissao) notFound();

  const itensDaOS: ItemDaOS[] = emissao.itens.map((item) => ({
    itemRevisionalId: item.itemRevisionalId,
    nome: item.itemRevisional.nome,
    categoria: item.itemRevisional.categoria,
    grupo: item.itemRevisional.grupo,
    etapa1: item.itemRevisional.etapa1,
    etapa2: item.itemRevisional.etapa2,
    etapa3: item.itemRevisional.etapa3,
    executado: item.executado,
    observacao: item.observacao,
  }));

  const secoes = secoesDaOS(itensDaOS);
  const executados = itensDaOS.filter((item) => item.executado).length;
  const totalDeMinutos = totalDeMinutosGravados(emissao.servicos);

  const empresa = emissao.ativo.empresa;
  const documentoDaEmpresa = empresa?.cnpj ?? empresa?.cpf ?? null;

  return (
    <div className="os-folha">
      <div className="os-controles no-print">
        <a className="btn btn-ghost" href="/emissao">
          Voltar
        </a>
        <BotaoImprimir />
      </div>

      <header className="os-cabecalho">
        <div>
          <div className="os-marca">{emissao.conta.nome}</div>
          <div className="os-sub">CNPJ {emissao.conta.cnpj}</div>
        </div>
        <div className="os-identificacao">
          <div className="os-titulo">Ordem de Serviço</div>
          <div className="os-codigo">{emissao.codigo}</div>
          <div className="os-sub">{emissao.status}</div>
        </div>
      </header>

      <section className="os-bloco">
        <h2 className="os-bloco-titulo">Informações gerais</h2>
        <dl className="os-campos">
          <Campo rotulo="Ativo" valor={`${emissao.ativo.codigo} — ${emissao.ativo.nome}`} />
          <Campo rotulo="Tipo de ativo" valor={emissao.ativo.tipoAtivo.nome} />
          <Campo rotulo="Localização" valor={emissao.ativo.localizacao} />
          <Campo rotulo="Nº de série" valor={emissao.ativo.numeroSerie} />
          <Campo
            rotulo="Empresa proprietária"
            valor={empresa ? empresa.razaoSocial : null}
            complemento={documentoDaEmpresa}
          />
          <Campo rotulo="Plano revisional" valor={emissao.plano.nome} />
          <Campo rotulo="Responsável" valor={emissao.responsavel.nome} />
          <Campo rotulo="Setor" valor={LABEL_POR_SETOR[emissao.setor]} />
          <Campo rotulo="Data de criação" valor={formatarInstante(emissao.dataEmissao)} />
          <Campo rotulo="Agendamento" valor={formatarInstante(emissao.dataAgendamento)} />
          <Campo rotulo="Início" valor={formatarInstante(emissao.dataInicio)} />
          <Campo rotulo="Fim" valor={formatarInstante(emissao.dataFim)} />
        </dl>
      </section>

      <section className="os-bloco">
        <h2 className="os-bloco-titulo">
          Itens revisionais
          <span className="os-contador">
            {executados} de {itensDaOS.length} executados
          </span>
        </h2>

        {secoes.length === 0 ? (
          <p className="os-vazio">Esta emissão não tem itens.</p>
        ) : (
          secoes.map((secao) => (
            <table className="os-tabela" key={secao.categoria}>
              <thead>
                <tr>
                  {/* Grupo + Item + etapas visíveis + Executado + Observação */}
                  <th className="os-secao" colSpan={4 + secao.quantidadeDeEtapas}>
                    {secao.categoria}
                  </th>
                </tr>
                <tr>
                  <th className="os-col-grupo">Grupo</th>
                  <th>Item</th>
                  {secao.etapasVisiveis.etapa1 && <th>Etapa 1</th>}
                  {secao.etapasVisiveis.etapa2 && <th>Etapa 2</th>}
                  {secao.etapasVisiveis.etapa3 && <th>Etapa 3</th>}
                  <th className="os-col-executado">Executado</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {secao.itens.map((item) => (
                  <tr key={item.itemRevisionalId}>
                    <td>{rotuloDoGrupo(item.grupo)}</td>
                    <td>{item.nome}</td>
                    {secao.etapasVisiveis.etapa1 && <td>{item.etapa1 ?? ""}</td>}
                    {secao.etapasVisiveis.etapa2 && <td>{item.etapa2 ?? ""}</td>}
                    {secao.etapasVisiveis.etapa3 && <td>{item.etapa3 ?? ""}</td>}
                    <td className="os-col-executado">{item.executado ? "Sim" : "Não"}</td>
                    <td>{item.observacao ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}
      </section>

      <section className="os-bloco">
        <h2 className="os-bloco-titulo">
          Apontamento de mão de obra
          <span className="os-contador">Total {formatarMinutos(totalDeMinutos)}</span>
        </h2>

        {emissao.servicos.length === 0 ? (
          <p className="os-vazio">Nenhum serviço lançado.</p>
        ) : (
          <table className="os-tabela">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Item</th>
                <th>Início</th>
                <th>Fim</th>
                <th className="os-col-duracao">Duração</th>
              </tr>
            </thead>
            <tbody>
              {emissao.servicos.map((servico) => {
                const minutos = minutosDoServicoGravado(servico);
                return (
                  <tr key={servico.id}>
                    <td>{servico.pessoa.nome}</td>
                    <td>{servico.itemRevisional.nome}</td>
                    <td>{formatarInstante(servico.inicio)}</td>
                    <td>{formatarInstante(servico.fim)}</td>
                    {/* Linha sem duração apurável imprime travessão, nunca
                        "0:00" — e já ficou fora do total (NFR7). */}
                    <td className="os-col-duracao">
                      {minutos === null ? DURACAO_INVALIDA : formatarMinutos(minutos)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="os-assinaturas">
        <div className="os-assinatura">
          <span className="os-linha-assinatura" />
          Executante
        </div>
        <div className="os-assinatura">
          <span className="os-linha-assinatura" />
          Responsável — {emissao.responsavel.nome}
        </div>
      </section>

      <footer className="os-rodape">
        {emissao.codigo} · emitida em {formatarDia(emissao.dataEmissao)} · impressa por{" "}
        {usuarioSessao.nome}
      </footer>
    </div>
  );
}

// Campo não preenchido imprime travessão em vez de desaparecer: no papel, a
// ausência do rótulo é indistinguível de esquecimento de quem imprimiu.
function Campo({
  rotulo,
  valor,
  complemento,
}: {
  rotulo: string;
  valor: string | null | undefined;
  complemento?: string | null;
}) {
  const preenchido = valor !== null && valor !== undefined && valor.trim() !== "";
  return (
    <div className="os-campo">
      <dt>{rotulo}</dt>
      <dd>
        {preenchido ? valor : "—"}
        {preenchido && complemento ? <span className="os-sub"> {complemento}</span> : null}
      </dd>
    </div>
  );
}
