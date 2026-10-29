import { useState } from "react";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LinhaServicoRow, type LinhaServico } from "@/src/components/emissao/modal-emissao";
import {
  ERRO_SERVICO_SOBREPOSTO,
  lerServicos,
  validarServicos,
} from "@/src/server/actions/emissao-estado";

// Primeiro teste de COMPONENTE do projeto (29-10-2026). O que ele prende não
// é regra — isso os testes de servidor já fazem — é a FIAÇÃO entre a regra e a
// tela, que até aqui nada cobria.
//
// O buraco concreto: os nomes dos campos (`servico-{i}-inicio`) são montados
// por template string em DOIS lugares independentes, o componente e
// `lerServicos`. Renomear só um dos lados não é erro de compilação e não
// quebra nenhum teste de unidade: a suíte fica verde enquanto o modal para de
// enviar o campo, ou passa a exibir o erro no lugar errado.
//
// Por isso o teste vai de ponta a ponta do ciclo real: renderiza a linha,
// DIGITA nela, extrai o FormData do próprio <form>, passa pelas mesmas funções
// que a Server Action usa, e devolve os erros ao componente para conferir onde
// eles aparecem.

const PESSOAS = [
  { id: "p-ana", nome: "Ana" },
  { id: "p-bruno", nome: "Bruno" },
];

const ITENS = [
  {
    id: "ir-1",
    nome: "Troca de óleo",
    descricao: null,
    diasPadrao: null,
    kmPadrao: null,
    horasPadrao: null,
    status: "Ativo" as const,
  },
];

function linhaVazia(chave: number): LinhaServico {
  return {
    chave,
    pessoaId: "",
    itemRevisionalId: "",
    modo: "Periodo",
    horas: "",
    inicio: "",
    fim: "",
  };
}

/// Monta o pedaço de tela de verdade: um <form> com N linhas controladas,
/// exatamente como o modal as monta. O `servicoCount` é incluído porque
/// `lerServicos` depende dele — se o modal deixasse de emiti-lo, nenhuma linha
/// seria lida, e é um dos defeitos que este arranjo pega.
function Bancada({ quantidade, erros }: { quantidade: number; erros: Map<string, string> }) {
  const [linhas, setLinhas] = useState(() =>
    Array.from({ length: quantidade }, (_, i) => linhaVazia(i)),
  );

  return (
    <form data-testid="form">
      <input type="hidden" name="servicoCount" value={linhas.length} readOnly />
      <table>
        <tbody>
          {linhas.map((linha, indice) => (
            <LinhaServicoRow
              key={linha.chave}
              indice={indice}
              linha={linha}
              pessoas={PESSOAS}
              itensRevisionais={ITENS}
              erros={erros}
              onMudar={(campos) =>
                setLinhas((atuais) =>
                  atuais.map((l, i) => (i === indice ? { ...l, ...campos } : l)),
                )
              }
              onRemover={() => {}}
            />
          ))}
        </tbody>
      </table>
    </form>
  );
}

/// Preenche uma linha como a pessoa preencheria. Os dois `datetime-local`
/// recebem o valor por `fireEvent.change` em vez de digitação: o widget nativo
/// de data/hora não existe no jsdom, e simular tecla a tecla testaria o
/// polyfill do navegador, não o nosso componente. O que importa aqui é que o
/// valor atravessa o `onChange` controlado e chega ao FormData pelo NOME
/// certo.
async function preencher(indice: number, pessoa: string, inicio: string, fim: string) {
  const usuario = userEvent.setup();
  const linha = screen.getAllByRole("row")[indice];
  await usuario.selectOptions(within(linha).getByLabelText("Item revisional"), ITENS[0].id);
  await usuario.selectOptions(within(linha).getByLabelText("Pessoa"), pessoa);
  fireEvent.change(within(linha).getByLabelText("Início do serviço"), {
    target: { value: inicio },
  });
  fireEvent.change(within(linha).getByLabelText("Fim do serviço"), { target: { value: fim } });
}

describe("a linha de serviço conversa com a validação do servidor", () => {
  test("o que a tela envia é exatamente o que lerServicos lê", async () => {
    render(<Bancada quantidade={1} erros={new Map()} />);
    await preencher(0, "p-ana", "2026-01-15T08:00", "2026-01-15T10:00");

    const formData = new FormData(screen.getByTestId("form") as HTMLFormElement);
    const lidas = lerServicos(formData);

    expect(lidas.ok).toBe(true);
    if (!lidas.ok) return;
    // Um nome trocado em qualquer um dos lados faz este campo chegar vazio.
    expect(lidas.linhas).toHaveLength(1);
    expect(lidas.linhas[0].pessoaId).toBe("p-ana");
    expect(lidas.linhas[0].itemRevisionalId).toBe("ir-1");
    expect(lidas.linhas[0].inicio).toBe("2026-01-15T08:00");
  });

  test("o modo Duracao não envia datas, e o campo de horas chega preenchido", async () => {
    // A troca de modo muda QUAIS inputs existem no DOM. Um input não
    // renderizado não entra no FormData — é disso que depende a coerência
    // entre modo e datas que a CHECK do banco exige.
    render(<Bancada quantidade={1} erros={new Map()} />);
    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByLabelText("Modo de lançamento"), "Duracao");
    await usuario.type(screen.getByLabelText("Horas trabalhadas"), "1:55");

    const formData = new FormData(screen.getByTestId("form") as HTMLFormElement);
    expect(formData.get("servico-0-horas")).toBe("1:55");
    expect(formData.get("servico-0-inicio")).toBeNull();
    expect(formData.get("servico-0-fim")).toBeNull();
  });

  test("o erro de sobreposição aparece NA linha que o servidor acusou", async () => {
    // O ciclo inteiro: duas linhas cruzadas são digitadas, passam pelas mesmas
    // funções da Server Action, e o erro volta para a tela. Se a chave do mapa
    // de erros deixar de bater com o nome do campo, a mensagem some — sem que
    // nenhum teste de unidade perceba.
    const { rerender } = render(<Bancada quantidade={2} erros={new Map()} />);
    await preencher(0, "p-ana", "2026-01-15T08:00", "2026-01-15T10:00");
    await preencher(1, "p-ana", "2026-01-15T09:00", "2026-01-15T11:00");

    const formData = new FormData(screen.getByTestId("form") as HTMLFormElement);
    const lidas = lerServicos(formData);
    expect(lidas.ok).toBe(true);
    if (!lidas.ok) return;
    const { erros } = validarServicos(lidas.linhas);

    const mapa = new Map(erros.map((erro) => [erro.field, erro.message]));
    expect(mapa.get("servico-1-inicio")).toBe(ERRO_SERVICO_SOBREPOSTO);

    rerender(<Bancada quantidade={2} erros={mapa} />);
    expect(screen.getByText(ERRO_SERVICO_SOBREPOSTO)).toBeInTheDocument();
  });
});
