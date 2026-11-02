import { Sidebar } from "@/src/components/shell/sidebar";
import { Topbar } from "@/src/components/shell/topbar";
import { resolverPaleta } from "@/src/lib/paletas";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarOpcoesDeAmbiente } from "@/src/server/repositories/vinculo-conta";

// Casca autenticada (topbar/sidebar/breadcrumb) — toda rota fora de (auth)
// exige sessão autenticada e redireciona ao login sem sessão (Boundaries).
// O guard de sessão/status em si vive em exigirUsuarioAutenticado() — nunca
// reimplementado aqui.
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const usuario = await exigirUsuarioAutenticado();

  // Paleta da Conta (CAP-11 / AD-11, Story 1.5): resolverPaleta cai para
  // PALETA_PADRAO se o valor salvo não bater com nenhuma chave conhecida
  // (ex. dado legado/corrompido) — nunca quebra o layout. Renderizada como
  // <style> (em vez de inline por elemento) porque sobrescreve, pra toda a
  // árvore (topbar/sidebar/botões), as variáveis --forest/--pine/... que o
  // :root de globals.css já declara com os valores de "verde-floresta"
  // (Code Map). Nunca se aplica a app/(plataforma) (Boundaries — Never):
  // aquele layout não importa este componente.
  const paleta = resolverPaleta(usuario.conta.paletaDeCores);

  // Story 6.5: os ambientes que esta identidade pode escolher, pela MESMA
  // função que a tela de seleção da 6.4 usa (AD-1) — nunca uma consulta própria
  // daqui, para o que a topbar oferece e o que a Server Action revalida nunca
  // divergirem. Com um único ambiente a `Topbar` não renderiza seletor nenhum.
  //
  // Diferido da 6.5, fechado em 02-11-2026: a consulta rodava em TODA
  // requisição autenticada, com join em conta e perfil, inclusive para a
  // maioria que tem um ambiente só e descarta o resultado. Quando a guarda
  // resolveu pela derivação do vínculo único, ela JÁ contou — e nesse caso a
  // lista é previsível sem consultar nada.
  //
  // Quando a contagem não é conhecida (sessão com conta ativa gravada, que é
  // exatamente quem tem mais de um ambiente), a consulta continua — é o caso
  // que precisa do seletor.
  const opcoesDeConta =
    usuario.ambientesEscolhiveis === 1
      ? [
          {
            contaId: usuario.contaId,
            contaNome: usuario.conta.nome,
            perfilNome: usuario.perfilAcesso.nome,
          },
        ]
      : await listarOpcoesDeAmbiente(usuario.id);

  return (
    <>
      <style>{`:root{--forest:${paleta.forest};--forest-2:${paleta.forest2};--pine:${paleta.pine};--pine-dark:${paleta.pineDark};--sage:${paleta.sage};--sage-pale:${paleta.sagePale};}`}</style>
      <Topbar
        nome={usuario.nome}
        papel={usuario.perfilAcesso.nome}
        opcoesDeConta={opcoesDeConta}
        contaAtivaId={usuario.contaId}
      />
      <Sidebar ehOperadorDePlataforma={usuario.isPlataformaOperador} />
      <div className="main">{children}</div>
    </>
  );
}
