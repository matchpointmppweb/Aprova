"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ativarUsuarioConvidado,
  registrarUltimoAcesso,
} from "@/src/server/repositories/usuario";
import {
  definirContaAtivaDaSessao,
  resolveuAConta,
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_ACESSO,
  STATUS_COM_LOGIN,
  trocarContaAtivaDaSessao,
  type UsuarioResolvidoPeloVinculo,
} from "@/src/server/repositories/vinculo-conta";
import { ROTA_CONTAS_PLATAFORMA, ROTA_ESCOLHER_AMBIENTE } from "@/src/lib/rotas";
import { auth } from "@/src/server/auth";
import {
  ipDosCabecalhos,
  limparFalhas,
  limparTentativasAntigas,
  registrarFalha,
  tentativaPermitida,
} from "@/src/server/auth/limite-de-tentativas";
import type { SessaoAtiva, UsuarioSessao } from "@/src/server/auth/tipos";
import type { EstadoAcaoAuth } from "./auth-estado";

const ERRO_CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos.";

// Distinta da mensagem de credencial inválida, e é seguro que seja: ela não
// revela se o e-mail existe — só que houve tentativas demais a partir daqui.
// Esconder o bloqueio faria a pessoa legítima insistir contra uma parede sem
// entender por quê.
const ERRO_MUITAS_TENTATIVAS =
  "Tentativas demais. Aguarde alguns minutos antes de tentar novamente.";

// Story 6.4 (FR22): esta mensagem só aparece DEPOIS da senha correta. Ela
// confirma, a quem já provou saber a senha, que a identidade existe — e isso
// não é enumeração por terceiros: a recusa por credencial errada continua
// sendo ERRO_CREDENCIAIS_INVALIDAS, genérica e indistinguível. Antes da 6.4 os
// dois casos devolviam a mesma coisa, e quem ficava sem ambiente não tinha
// como saber se o problema era a senha ou o acesso.
const ERRO_SEM_AMBIENTE =
  "Nenhum ambiente disponível para este acesso. Fale com o administrador da sua conta.";

const ERRO_ESCOLHA_INVALIDA =
  "Escolha inválida. Selecione um dos ambientes disponíveis.";

const ERRO_PRIMEIRO_ACESSO =
  "Não foi possível concluir seu primeiro acesso. Tente novamente.";

// Passos finais comuns à entrada direta (um vínculo) e à entrada após escolha
// (vários vínculos): promover o convidado, se for o caso, e registrar o último
// acesso. Devolve `null` quando tudo correu bem, ou o estado de erro a
// devolver ao formulário — a sessão já foi revogada nesse caso.
//
// Given um usuário com status "Convite pendente" que já definiu sua senha via
// link, when faz login pela primeira vez -> status muda para "Ativo"
// automaticamente. Se a promoção falhar, não redireciona para "/": o guard de
// app/(dashboard)/layout.tsx exige status "Ativo" e mandaria o usuário de
// volta para /login sem explicação nenhuma. Melhor devolver um erro claro e
// desfazer a sessão recém criada.
//
// Story 6.2: a condição olha identidade E vínculo. A guarda de sessão exige
// `Ativo` nos dois lados; se só o vínculo estivesse ConvitePendente, o login
// passaria, a promoção seria pulada e a requisição seguinte expulsaria o
// usuário para /login sem explicação nenhuma.
//
// Story 6.4: a promoção é do vínculo ESCOLHIDO, e por isso passou a acontecer
// aqui — com dois vínculos, no momento do login ainda não se sabe qual conta é
// a da pessoa, e promover antes da escolha ativaria um vínculo que ela talvez
// nem fosse usar.
async function concluirEntrada(
  usuario: UsuarioResolvidoPeloVinculo,
): Promise<EstadoAcaoAuth | null> {
  if (
    usuario.status === "ConvitePendente" ||
    usuario.statusDoVinculo === "ConvitePendente"
  ) {
    try {
      // count 0 significa que a pessoa NÃO terminou a chamada podendo entrar:
      // sem vínculo com esta conta, ou desativada (identidade ou vínculo)
      // entre a leitura e a escrita do compare-and-set. Seguir para "/"
      // deixaria o usuário não promovido bater na guarda de sessão — mesma
      // falha que o catch abaixo já trata.
      const { count } = await ativarUsuarioConvidado(usuario.id, usuario.contaId);
      if (count === 0) {
        throw new Error("promoção de convidado não afetou nenhuma linha");
      }
    } catch {
      await auth.api.signOut({ headers: await headers() }).catch(() => {});
      return { ok: false, error: ERRO_PRIMEIRO_ACESSO };
    }
  }

  // Falha ao registrar o último acesso não deve barrar o login.
  // Story 6.3: `ultimoAcesso` é da identidade, sem recorte por conta — a
  // função deixou de receber `contaId`.
  await registrarUltimoAcesso(usuario.id).catch(() => {});

  return null;
}

// Given e-mail ou senha errados -> mensagem de erro genérica (Boundaries:
// "mensagens de erro de login/reset nunca revelam se o e-mail existe").
export async function entrarAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const manterConectado = formData.get("manterConectado") === "on";

  if (!email || !senha) {
    return { ok: false, error: "Informe e-mail e senha." };
  }

  // Contenção de força bruta. A consulta vem ANTES de `signInEmail` de
  // propósito: verificar a senha custa um hash caro (é o ponto dele), e deixar
  // esse custo acessível a quem já estourou o limite transformaria a própria
  // defesa em vetor de sobrecarga.
  const ip = ipDosCabecalhos(await headers());
  if (!(await tentativaPermitida("login", email, ip))) {
    return { ok: false, error: ERRO_MUITAS_TENTATIVAS };
  }

  let usuarioSessao: UsuarioSessao | null = null;
  try {
    const resultado = await auth.api.signInEmail({
      body: { email, password: senha, rememberMe: manterConectado },
    });
    usuarioSessao = resultado.user as unknown as UsuarioSessao;
  } catch {
    await registrarFalha("login", email, ip);
    // Oportunista: não há tarefa agendada no projeto, e este caminho já é
    // lento por natureza.
    await limparTentativasAntigas();
    return { ok: false, error: ERRO_CREDENCIAIS_INVALIDAS };
  }

  // Senha correta zera o histórico DAQUELE e-mail (nunca o do IP — ver
  // `limparFalhas`), para que erros espalhados ao longo de semanas não se
  // somem em bloqueio para quem de fato é dono da conta.
  await limparFalhas("login", email);

  // Usuario.status/Conta.status não são checados pelo Better Auth — um
  // usuário Inativo ou uma conta com pagamento pendente não autentica,
  // mesmo com senha correta. Um usuário ConvitePendente autentica
  // normalmente (só chega aqui se já definiu senha via link de convite —
  // signInEmail já validou a senha acima) e é promovido a Ativo abaixo. A
  // sessão já foi criada em signInEmail, então revogamos antes de recusar.
  //
  // Story 6.2: a conta do login é resolvida pelo vínculo (identidade +
  // vínculo com status que permita login + Conta Ativa, tudo no mesmo
  // `where`), exatamente como a guarda de sessão.
  //
  // Story 6.4: os três desfechos passam a ser distintos — entrar direto (um
  // vínculo), escolher (vários) ou recusar por ambiente indisponível (zero).
  // Nenhuma conta ativa é passada aqui: a sessão acabou de nascer, e quem tem
  // um vínculo só nunca precisa de nada gravado.
  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
  );

  if (resolucao.tipo === "sem-ambiente") {
    // O operador de plataforma é a exceção, e é o ponto do AD-13: o papel é da
    // IDENTIDADE e a área de Contas não pertence a conta nenhuma. Derrubar a
    // sessão aqui deixaria um operador sem vínculo permanentemente fora do
    // sistema — anulando justamente o motivo de exigirOperadorDePlataforma()
    // ter deixado de exigir vínculo. A sessão fica de pé e ele vai para a área
    // dele; o flag é revalidado contra o banco lá, pelo gate.
    if (usuarioSessao.isPlataformaOperador) {
      redirect(ROTA_CONTAS_PLATAFORMA);
    }

    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    return { ok: false, error: ERRO_SEM_AMBIENTE };
  }

  // Mais de um vínculo utilizável: a sessão fica de pé (sem conta ativa) e a
  // escolha acontece na tela intermediária. Nada é escolhido aqui — nem a
  // promoção de convidado nem o registro de acesso acontecem antes de a pessoa
  // dizer em qual ambiente está entrando.
  if (resolucao.tipo === "ambiguo") {
    redirect(ROTA_ESCOLHER_AMBIENTE);
  }

  const erro = await concluirEntrada(resolucao.usuario);
  if (erro) {
    return erro;
  }

  redirect("/");
}

// Escolha do ambiente na tela intermediária (Story 6.4, FR22). O `contaId`
// submetido é palpite do cliente até esta action revalidá-lo contra o banco
// (NFR2): a página oferece opções, mas quem decide é
// resolverUsuarioAutenticadoPeloVinculo, que exige vínculo utilizável daquela
// identidade com aquela conta e conta Ativa. Escolha forjada não grava nada.
export async function escolherAmbienteAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const contaId = String(formData.get("contaId") ?? "").trim();

  if (!contaId) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const sessaoAtiva = sessao.session as unknown as SessaoAtiva;

  // Uma conta ativa VÁLIDA já gravada não é sobrescrita por esta action: trocar
  // de conta com a sessão estabelecida é a Story 6.5, e aceitar aqui um
  // `contaId` de outra conta implementaria a troca por acidente — inclusive
  // para quem forjasse o POST. Esta action só CONCLUI o login.
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

  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
    contaId,
  );

  // Não basta ter resolvido ALGO: sem vínculo com a conta pedida a resolução
  // cai na contagem e pode devolver outra conta. `resolveuAConta` é a mesma
  // pergunta que a guarda e a página fazem.
  if (!resolveuAConta(resolucao, contaId)) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  // A promoção do convidado vem ANTES da gravação: se ela falhar, a sessão é
  // revogada por concluirEntrada e nada fica apontando para um vínculo não
  // promovido — o que faria a guarda expulsar a pessoa sem explicação na
  // requisição seguinte.
  const erro = await concluirEntrada(resolucao.usuario);
  if (erro) {
    return erro;
  }

  // count 0: a sessão sumiu ou foi rotacionada entre a leitura e esta escrita —
  // exatamente o caso para o qual o `where` foi endurecido. Seguir para "/"
  // faria a guarda ver sessão sem conta ativa e devolver à seleção, num laço
  // sem mensagem nenhuma. Mesmo compare-and-set dos demais desta story.
  const { count } = await definirContaAtivaDaSessao(
    sessaoAtiva.id,
    usuarioSessao.id,
    contaId,
  );
  if (count === 0) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  redirect("/");
}

// Troca de conta com a sessão já estabelecida (Story 6.5, FR23). É a irmã da
// `escolherAmbienteAction`, e a diferença entre as duas é deliberada: aquela
// CONCLUI o login (e por isso recusa-se a mexer numa conta ativa já válida),
// esta TROCA uma conta ativa válida por outra.
//
// AD-24 revisado (com confirmação de Fulvi): a troca muta a conta ativa da
// SESSÃO em vez de emitir sessão nova. Emitir token novo não entregava a
// proteção que aparentava — quem tem token válido pode acionar a troca e obter
// o token da outra conta de qualquer forma —, e o Better Auth não expõe emissão
// de sessão sem credenciais. O que a decisão original entregava de verdade era
// auditoria, e ela é recuperada explicitamente aqui: toda troca bem-sucedida
// grava identidade, conta anterior, conta nova e momento, na MESMA transação
// da mudança (AD-9).
//
// O controle de acesso NÃO depende disto: continua sendo o NFR6 — o vínculo com
// a conta ativa é revalidado contra o banco a cada requisição, então uma conta
// que deixou de valer é rejeitada na requisição seguinte, qualquer que seja o
// token.
export async function trocarDeContaAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const contaId = String(formData.get("contaId") ?? "").trim();

  if (!contaId) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const sessaoAtiva = sessao.session as unknown as SessaoAtiva;

  // Parte 1 da revalidação: DE ONDE se está saindo. A conta anterior é o que a
  // auditoria registra, e um registro de auditoria cuja razão de existir é ser
  // exato não pode gravar uma conta que a sessão nunca apontou — gravar a conta
  // errada é pior do que não gravar. Por isso a mesma checagem de DUAS partes
  // que a guarda, a página e a `escolherAmbienteAction` fazem: `resolveuAConta`
  // contra o PONTEIRO DA SESSÃO, e não só `tipo === "resolvido"` — sem vínculo
  // com a conta apontada, a resolução cai em derivação e devolveria OUTRA conta.
  const ponteiro = sessaoAtiva.contaAtivaId;
  const atual = ponteiro
    ? await resolverUsuarioAutenticadoPeloVinculo(
        usuarioSessao.id,
        STATUS_COM_ACESSO,
        ponteiro,
      )
    : null;

  // Ponteiro ausente ou morto tem desfecho PRÓPRIO, e não o mesmo da troca para
  // a conta já ativa: aqui não há "de onde" — o seletor só existe com mais de um
  // ambiente, e nesse caso a sessão tem de ter conta ativa válida. A tela de
  // seleção é o lugar de escolher sem origem; a guarda corrige dali (ou cai no
  // login, se não sobrou ambiente nenhum).
  if (!ponteiro || !atual || !resolveuAConta(atual, ponteiro)) {
    redirect(ROTA_ESCOLHER_AMBIENTE);
  }

  const contaAnteriorId = atual.usuario.contaId;

  // Trocar para a conta já ativa não é troca: nada a gravar, e um registro de
  // auditoria aqui seria ruído — "trocou de A para A" polui justamente o
  // histórico que esta story existe para criar.
  if (contaId === contaAnteriorId) {
    redirect("/");
  }

  // Parte 2: PARA ONDE se está indo. `STATUS_COM_LOGIN` de propósito, e não
  // `STATUS_COM_ACESSO` — é a mesma lista (STATUS_ESCOLHIVEL) que o seletor usa
  // para oferecer as opções. Revalidar mais estrito que a oferta significaria
  // recusar um ambiente que a topbar acabou de listar; um vínculo
  // ConvitePendente é escolhível, e é promovido a Ativo junto da troca, logo
  // abaixo.
  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
    contaId,
  );

  // Não basta ter resolvido ALGO: sem vínculo com a conta pedida a resolução
  // cai na derivação e pode devolver outra conta. Esta é a defesa contra a
  // troca forjada e contra o vínculo revogado entre o render e o submit —
  // recusa aqui, e a conta ativa anterior permanece intacta, sem auditoria
  // nenhuma gravada (NFR2).
  if (!resolveuAConta(resolucao, contaId)) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  // A promoção do convidado NÃO passa por `concluirEntrada` aqui, e a diferença
  // é toda de contexto: no login aquele caminho revoga a sessão quando a
  // promoção falha, porque não há sessão legítima a preservar. Numa TROCA há —
  // falhar ao entrar na conta B não pode deslogar quem está legitimamente na
  // conta A. Por isso a promoção viaja para dentro da transação da troca, onde
  // ou acontece junto dela, ou não acontece: promovida antes, uma troca
  // recusada deixaria o vínculo Ativo sem troca e sem auditoria.
  const promoverVinculo =
    resolucao.usuario.status === "ConvitePendente" ||
    resolucao.usuario.statusDoVinculo === "ConvitePendente";

  // Conta ativa, promoção e auditoria numa transação só (AD-9). Os nomes e o
  // e-mail são copiados para a linha de auditoria (ver o modelo): é o que a
  // mantém legível quando a conta é renomeada ou apagada.
  const { count } = await trocarContaAtivaDaSessao({
    sessaoId: sessaoAtiva.id,
    usuarioId: usuarioSessao.id,
    usuarioEmail: resolucao.usuario.email,
    contaAnteriorId,
    contaAnteriorNome: atual.usuario.conta.nome,
    contaNovaId: contaId,
    contaNovaNome: resolucao.usuario.conta.nome,
    promoverVinculo,
  });

  // count 0 NÃO é escolha inválida, e por isso não devolve a mensagem de
  // escolha: é a sessão que sumiu/rotacionou, ou outra aba que já trocou a conta
  // ativa no meio do caminho. Nenhum dos dois se resolve escolhendo de novo —
  // insistir contra uma sessão morta seria um laço sem fim. "/" entrega o caso à
  // guarda, que é quem sabe o desfecho certo para cada um: login para a sessão
  // que não existe mais, painel da conta que a outra aba escolheu para a troca
  // concorrente.
  if (count === 0) {
    redirect("/");
  }

  // Melhor esforço, como no login: falhar aqui não desfaz uma troca já gravada.
  await registrarUltimoAcesso(usuarioSessao.id).catch(() => {});

  // A casca autenticada inteira (dados, `can()` e paleta — AD-11) é derivada da
  // conta ativa no layout; sem invalidar o layout, a navegação de cliente
  // poderia reexibir a árvore da conta anterior.
  revalidatePath("/", "layout");
  redirect("/");
}

// Given e-mail existente ou não -> mesma resposta de sucesso na tela (sem
// enumeration); o próprio Better Auth já responde de forma indistinguível
// nos dois casos.
export async function solicitarResetSenhaAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "Informe seu e-mail." };
  }

  // Limite próprio, mais apertado que o do login: cada solicitação dispara um
  // e-mail, então sem contenção este formulário vira ferramenta para inundar a
  // caixa de entrada de alguém. Cota separada da do login porque errar a senha
  // não pode gastar a cota de RECUPERAÇÃO — que é justamente o caminho de quem
  // errou a senha.
  const ip = ipDosCabecalhos(await headers());
  const permitida = await tentativaPermitida("reset", email, ip);

  if (permitida) {
    try {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: "/redefinir-senha" },
      });
    } catch {
      // Ignorado de propósito: a resposta ao usuário é sempre a mesma,
      // exista o e-mail ou não.
    }

    // Aqui TODA solicitação conta, e não só as que falham: não existe
    // "solicitação errada" a distinguir, e é o volume que precisa ser contido.
    await registrarFalha("reset", email, ip);
    await limparTentativasAntigas();
  }

  // MESMA resposta com ou sem limite estourado. Dizer "muitas tentativas" aqui
  // revelaria que aquele e-mail existe — exatamente a enumeração que a
  // mensagem genérica abaixo existe para impedir. Quem estourou o limite
  // simplesmente não recebe e-mail.
  return {
    ok: true,
    message:
      "Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
  };
}

export async function redefinirSenhaAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const token = String(formData.get("token") ?? "");
  const novaSenha = String(formData.get("novaSenha") ?? "");
  const confirmarSenha = String(formData.get("confirmarSenha") ?? "");

  if (!token) {
    return {
      ok: false,
      error: "Link de redefinição inválido ou expirado. Solicite um novo.",
    };
  }
  if (novaSenha.length < 8) {
    return { ok: false, error: "A senha deve ter pelo menos 8 caracteres." };
  }
  if (novaSenha !== confirmarSenha) {
    return { ok: false, error: "As senhas não coincidem." };
  }

  try {
    await auth.api.resetPassword({ body: { newPassword: novaSenha, token } });
  } catch {
    // Nunca expõe detalhe interno/stack (Boundaries) — mensagem genérica.
    return {
      ok: false,
      error:
        "Não foi possível redefinir sua senha. O link pode ter expirado — solicite um novo.",
    };
  }

  return {
    ok: true,
    message: "Senha redefinida com sucesso. Você já pode entrar com a nova senha.",
  };
}

export async function sairAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Sessão já pode estar expirada/inválida — mesmo assim, sempre manda
    // de volta para o login.
  }
  redirect("/login");
}
