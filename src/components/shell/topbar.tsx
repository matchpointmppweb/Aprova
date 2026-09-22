import Link from "next/link";

import type { OpcaoDeAmbiente } from "@/src/components/auth/escolher-ambiente-form";
import { SeletorDeConta } from "@/src/components/shell/seletor-de-conta";
import { ROTA_CONTAS_PLATAFORMA } from "@/src/lib/rotas";
import { sairAction } from "@/src/server/actions/auth";

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "?";
}

// Portado de Mockup.html (#view-app .topbar, AD-4). O ícone de sair
// (`title="Sair"`) não existe no mockup original (a demo estática não tinha
// logout funcional) — é a única adição necessária para uma casca de
// aplicação real.
//
// Story 6.5: recebe também os ambientes escolhíveis e a conta ativa. O seletor
// de conta só existe com MAIS DE UM ambiente — com um só, a topbar é
// exatamente a de antes desta story (Boundaries). A decisão é feita aqui, e
// não dentro do seletor, para que quem tem um ambiente só não baixe um Client
// Component que nunca teria o que oferecer.
export function Topbar({
  nome,
  papel,
  opcoesDeConta,
  contaAtivaId,
  ehOperadorDePlataforma,
}: {
  nome: string;
  papel: string;
  opcoesDeConta: OpcaoDeAmbiente[];
  contaAtivaId: string;
  ehOperadorDePlataforma: boolean;
}) {
  // Mais de um ambiente E a conta ativa entre eles. A segunda metade não é
  // paranoia: a guarda e a lista de opções são duas consultas, e um vínculo que
  // some entre elas deixaria o `<select>` sem a opção correspondente ao valor
  // que ele recebe — o navegador então exibiria a PRIMEIRA opção como se fosse a
  // conta ativa, mentindo sobre em qual ambiente a pessoa está operando. Sem o
  // seletor, a requisição seguinte cai na guarda, que corrige (NFR6).
  const podeTrocarDeConta =
    opcoesDeConta.length > 1 &&
    opcoesDeConta.some((opcao) => opcao.contaId === contaAtivaId);

  return (
    <div className="topbar">
      <div className="brand-mark">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2C8 6 5 9 5 13a7 7 0 0 0 14 0c0-4-3-7-7-11z" fill="currentColor" />
        </svg>
      </div>
      <div className="topbar-title">Raiz</div>
      <div className="topbar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input placeholder="Buscar ativo, plano, emissão..." />
      </div>

      <button type="button" className="topbar-icon" title="Notificações">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <span className="dot" />
      </button>

      {/* Acesso à área de plataforma, visível SÓ para quem é operador. A
          segregação do AD-13 continua inteira — quem não é operador não vê nada
          aqui, e o gate de verdade segue sendo `exigirOperadorDePlataforma()`
          na própria rota, nunca este link.

          Existe porque o desenho original supunha que o operador de plataforma
          NÃO teria vínculo com conta alguma (é o que `ROTA_CONTAS_PLATAFORMA`
          faz no login: manda para cá quem entra sem vínculo). Um operador que
          também é Administrador de uma conta — o caso do administrador raiz —
          caía no painel da conta-cliente sem nenhum caminho de volta, exceto
          digitar a URL. Esconder a porta de quem tem a chave não era o
          objetivo. */}
      {ehOperadorDePlataforma ? (
        <Link
          href={ROTA_CONTAS_PLATAFORMA}
          className="topbar-icon"
          title="Área de plataforma"
          // `.topbar-icon` traz `margin-left:auto` — é o que empurra o bloco de
          // ícones para a direita. Num segundo elemento com a mesma classe e
          // filho direto da topbar, o espaço passaria a ser DIVIDIDO entre os
          // dois, afastando este do sino. O `auto` do sino, que vem antes, já
          // cumpre o papel.
          style={{ marginLeft: 0 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="6" rx="1" />
            <rect x="3" y="14" width="18" height="6" rx="1" />
            <path d="M7 7h.01M7 17h.01" />
          </svg>
        </Link>
      ) : null}

      <form action={sairAction}>
        <button type="submit" className="topbar-icon" title="Sair">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </form>

      <div className="topbar-user">
        {podeTrocarDeConta ? (
          <SeletorDeConta opcoes={opcoesDeConta} contaAtivaId={contaAtivaId} />
        ) : null}
        <div className="avatar">{iniciais(nome)}</div>
        <div>
          <div className="name">{nome}</div>
          <div className="role">{papel}</div>
        </div>
      </div>
    </div>
  );
}
