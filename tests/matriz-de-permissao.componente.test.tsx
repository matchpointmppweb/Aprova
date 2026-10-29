import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { ModalPerfil } from "@/src/components/perfil-acesso/modal-perfil";
import { permissoesAcimaDoTeto } from "@/src/lib/teto-de-permissao";
import type { PerfilAcessoListagem, PermissaoListagem } from "@/src/components/perfil-acesso/tipos";

// O teto de permissões tem uma armadilha de TELA que nenhum teste de
// servidor alcança: uma caixa `disabled` não é enviada pelo navegador.
// Desabilitar uma permissão que o perfil-alvo JÁ TEM faria o submit chegar
// com ela ausente — e a gravação a apagaria em silêncio, que é pior do que
// o problema que o teto resolve.
//
// Por isso o caso vive aqui: o que se mede é o FormData que a tela produz.

function permissao(
  modulo: string,
  criar = false,
  editar = false,
  excluir = false,
): PermissaoListagem {
  return { modulo, criar, editar, excluir } as PermissaoListagem;
}

const ALVO: PerfilAcessoListagem = {
  id: "perfil-alvo",
  nome: "Operação",
  descricao: null,
  _count: { usuarios: 0 },
  permissoes: [permissao("ativos", true, true, true)],
};

/// O ator administra perfis e mexe em ativos só para editar — nem criar,
/// nem excluir.
const TETO: PermissaoListagem[] = [
  permissao("perfil", true, true, false),
  permissao("ativos", false, true, false),
];

function abrirModal(perfil: PerfilAcessoListagem | null) {
  render(
    <ModalPerfil perfil={perfil} tetoDoAtor={TETO} onFechar={() => {}} onSucesso={() => {}} />,
  );
  const form = document.querySelector("form");
  if (!form) throw new Error("o modal não renderizou um <form>");
  return form as HTMLFormElement;
}

describe("a matriz de permissões respeita o teto na tela", () => {
  test("a caixa fora do teto é desabilitada", () => {
    abrirModal(null);
    const caixas = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const porNome = new Map(caixas.map((c) => [c.getAttribute("name") ?? "(sem nome)", c]));

    expect(porNome.get("perm-perfil-criar")?.disabled).toBe(false);
    // Fora do teto: a caixa existe, mas travada e sem nome, então nem
    // marcada chegaria ao servidor.
    expect(porNome.has("perm-ativos-excluir")).toBe(false);
  });

  test("permissão do ALVO acima do teto sobrevive ao submit", () => {
    // O caso perigoso. O ator abre um perfil mais poderoso e salva sem
    // mexer em nada: as três permissões de `ativos` precisam chegar
    // inteiras, embora duas delas estejam travadas na tela.
    const form = abrirModal(ALVO);
    const formData = new FormData(form);

    expect(formData.get("perm-ativos-criar")).toBe("on");
    expect(formData.get("perm-ativos-editar")).toBe("on");
    expect(formData.get("perm-ativos-excluir")).toBe("on");
  });

  test("e o que a tela envia é aceito pela mesma regra do servidor", () => {
    // A fiação completa: o FormData da tela passa pela função que a Server
    // Action usa. Se os dois lados divergirem, salvar sem mexer em nada
    // viraria erro — e o perfil ficaria ineditável.
    const form = abrirModal(ALVO);
    const formData = new FormData(form);

    const solicitadas = ["ativos", "perfil"].map((modulo) => ({
      modulo,
      criar: formData.get(`perm-${modulo}-criar`) === "on",
      editar: formData.get(`perm-${modulo}-editar`) === "on",
      excluir: formData.get(`perm-${modulo}-excluir`) === "on",
    }));

    expect(permissoesAcimaDoTeto(solicitadas, TETO, ALVO.permissoes)).toEqual([]);
  });

  test("na CRIAÇÃO nada fora do teto é enviado", () => {
    // Sem perfil-alvo não há nada a preservar, então nenhuma caixa travada
    // carrega valor oculto — o oculto existe só para proteger o que já
    // estava gravado.
    const form = abrirModal(null);
    const formData = new FormData(form);

    expect(formData.get("perm-ativos-excluir")).toBeNull();
    expect(formData.get("perm-ativos-criar")).toBeNull();
  });
});
