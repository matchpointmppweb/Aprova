/**
 * Forma do usuário retornado por auth.api.getSession()/signInEmail() nesta
 * app — os campos base do Better Auth (com `name` mapeado para `nome`) mais
 * os additionalFields do domínio declarados em src/server/auth/index.ts.
 * Tipado à mão em vez de inferido genericamente do client do Better Auth
 * para manter o acoplamento explícito e óbvio de revisar quando o schema
 * mudar.
 *
 * Story 6.2: `contaId`/`perfilAcessoId` saíram daqui junto com os
 * additionalFields correspondentes. Conta ativa e perfil vêm do VinculoConta
 * (src/server/repositories/vinculo-conta.ts), revalidado a cada requisição —
 * o que a sessão carrega e os chamadores usam é apenas `id`.
 */
/**
 * Forma da SESSÃO (e não da identidade) retornada por auth.api.getSession() —
 * os campos base do Better Auth mais o additionalFields de sessão declarado em
 * src/server/auth/index.ts.
 *
 * Story 6.4: `contaAtivaId` é a conta escolhida NESTA sessão. Opcional porque
 * a sessão nasce sem ela e porque quem tem um único vínculo utilizável nunca
 * precisa gravá-la (a conta ativa é derivada do vínculo único). Nunca é lida
 * como autorização: a guarda revalida o vínculo contra o banco a cada
 * requisição (NFR6).
 */
export interface SessaoAtiva {
  id: string;
  userId: string;
  contaAtivaId?: string | null;
}

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  isPlataformaOperador: boolean;
  status: string;
  ultimoAcesso?: string | Date | null;
}
