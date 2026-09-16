import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { EscolherAmbienteForm } from "@/src/components/auth/escolher-ambiente-form";
import { auth } from "@/src/server/auth";
import type { SessaoAtiva, UsuarioSessao } from "@/src/server/auth/tipos";
import {
  listarOpcoesDeAmbiente,
  resolveuAConta,
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_LOGIN,
} from "@/src/server/repositories/vinculo-conta";

export const metadata: Metadata = {
  title: "Escolher ambiente — Raiz",
};

// Tela intermediária entre a senha correta e o painel (Story 6.4, FR22). Quem
// tem um único ambiente nunca é mandado para cá pelo login — entra direto.
//
// As opções vêm de listarOpcoesDeAmbiente, que usa a MESMA lista que decide a
// ambiguidade na guarda e no login (STATUS_ESCOLHIVEL, no repositório): a tela
// não escolhe o conjunto que oferece, senão poderia oferecer o que a
// revalidação não aceita — ou esconder o que a guarda contou.
//
// O que sai daqui é só o que a tela mostra (nome da conta + perfil), e nada
// disso autoriza nada: a escolha submetida é revalidada no servidor pela
// Server Action (NFR2).
export default async function EscolherAmbientePage() {
  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const sessaoAtiva = sessao.session as unknown as SessaoAtiva;

  // Sessão que JÁ tem conta ativa válida não vê esta tela, nem por URL: trocar
  // de conta com a sessão estabelecida é a Story 6.5, e deixar a rota servir
  // de seletor seria implementá-la por acidente. A escolha aqui é a que
  // CONCLUI o login — quem já escolheu vai para o painel.
  if (sessaoAtiva.contaAtivaId) {
    const jaEscolhida = await resolverUsuarioAutenticadoPeloVinculo(
      usuarioSessao.id,
      STATUS_COM_LOGIN,
      sessaoAtiva.contaAtivaId,
    );
    if (resolveuAConta(jaEscolhida, sessaoAtiva.contaAtivaId)) {
      redirect("/");
    }
  }

  const opcoes = await listarOpcoesDeAmbiente(usuarioSessao.id);

  // Nunca uma seleção vazia (I/O Matrix): sem nenhum ambiente utilizável não
  // há o que escolher, e a sessão não deve continuar de pé.
  if (opcoes.length === 0) {
    await auth.api.signOut({ headers: cabecalhos }).catch(() => {});
    redirect("/login");
  }

  // Uma opção só é renderizada, não pulada: quem chega aqui com um ambiente
  // apenas é, tipicamente, quem teve a conta ativa invalidada e ficou com uma
  // outra conta utilizável. Redirecionar para "/" nesse caso trocaria a pessoa
  // de tenant sem avisar — que é o que a guarda acabou de evitar ao mandá-la
  // para cá. Um clique explícito é barato; agir na conta errada não é.
  return <EscolherAmbienteForm opcoes={opcoes} />;
}
