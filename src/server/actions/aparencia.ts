"use server";

import { revalidatePath } from "next/cache";

import { ehPaletaValida } from "@/src/lib/paletas";
import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { atualizarConta } from "@/src/server/repositories/conta";
import type { EstadoAcaoAparencia } from "./aparencia-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// Given Administrador (ou qualquer perfil com
// can(usuario,'editar','aparencia') === true) autenticado, when escolhe uma
// paleta na grade -> Conta.paletaDeCores é atualizada e passa a valer para
// todos os usuários da conta na próxima carga de página deles
// (revalidatePath('/', 'layout') — Code Map). can() roda no servidor antes
// de qualquer escrita (AD-2) mesmo que a UI já desabilite os cartões sem
// essa permissão (Boundaries). Nunca persiste uma chave fora de
// src/lib/paletas.ts (I/O Matrix: "Paleta inválida enviada ao servidor") e
// nunca é chamada pelo toggle de modo claro/escuro (AD-11 — 100%
// client-side, sem Server Action).
export async function atualizarPaletaAction(
  _estadoAnterior: EstadoAcaoAparencia,
  formData: FormData,
): Promise<EstadoAcaoAparencia> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "aparencia");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const paletaDeCores = String(formData.get("paletaDeCores") ?? "").trim();
  if (!ehPaletaValida(paletaDeCores)) {
    // Nunca expõe detalhe interno (Boundaries) — chave desconhecida é
    // tratada como o mesmo erro genérico, nada é persistido.
    return { ok: false, error: ERRO_GENERICO };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarConta(usuarioSessao.contaId, { paletaDeCores });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }
  if (!atualizou) {
    return { ok: false, error: ERRO_GENERICO };
  }

  // Layout inteiro, não só /aparencia — topbar/sidebar/botões consomem as
  // vars de paleta no <style> server-side de app/(dashboard)/layout.tsx
  // (Code Map).
  revalidatePath("/", "layout");
  return { ok: true };
}
