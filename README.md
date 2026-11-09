# Raiz

Gestão de ativos e manutenção preventiva, multiempresa. Cada cliente é uma
**Conta** (tenant) isolada: ninguém de uma conta lê ou escreve nada de outra.

O ciclo central do produto é: um **Ativo** (um caminhão, um compressor) é de um
**Tipo**; um **Plano revisional** diz quais **Itens revisionais** aquele ativo
precisa e a cada quantos dias, quilômetros ou horas; e uma **Emissão** (a ordem
de serviço) registra o que foi de fato executado, por quem e em quanto tempo.

---

## Antes de qualquer coisa: o banco do `.env.local` é PRODUÇÃO

Não existe banco de desenvolvimento compartilhado. A `DATABASE_URL` do
`.env.local` aponta para o **mesmo Neon que o site em produção usa**.

Consequências que já morderam:

| Comando | O que faz de verdade |
| --- | --- |
| `npm run dev` | sobe o Next **conectado em produção** |
| `npm run build` | roda `prisma migrate deploy` **em produção** |
| `npm run dev:local` | sobe um PostgreSQL local em `.dev-db/` e usa ele |

Para desenvolver e testar à mão, use **`npm run dev:local`**. Ele aplica as
migrations no banco local, semeia os cenários de teste na primeira vez e então
roda `next dev` apontado para lá.

Para só validar que o projeto compila, use **`npx next build`**, nunca
`npm run build` — a diferença é que o segundo aplica migrations.

---

## Como rodar

```bash
npm install                 # postinstall roda `prisma generate`
npm run dev:local           # banco local + next dev em http://localhost:3000
npm run verificar           # lint + typecheck + testes + checagem de deriva
```

`npm run verificar` é o portão antes de publicar. Ele roda, nesta ordem:
ESLint, `tsc --noEmit`, a suíte inteira (452 testes em 25 arquivos) e
`prisma:deriva`, que confere se as migrations produzem exatamente o schema
declarado.

Para começar o banco local do zero, apague a pasta `.dev-db/`.

### Entrar no sistema local

`dev:local` semeia três conjuntos de identidades. Todas com a senha
`teste1234`:

| E-mail | Para quê |
| --- | --- |
| `admin@raiz.local` | administrador raiz, único com acesso à área de Contas |
| `multi@teste.local` | vinculado a DUAS contas — para na tela de escolha de ambiente |
| `unica@teste.local` | uma conta só — entra direto, sem tela intermediária |
| `rogerio@alfa.example.com` | administrador de uma conta cheia de dados de demonstração |

---

## Mapa do repositório

```
app/                        rotas (App Router), agrupadas por área
  (auth)/                   login, esqueci-senha, redefinir-senha
  (dashboard)/              o produto: ativos, planos, emissão, relatórios…
  (plataforma)/             área do operador de plataforma (Contas)
  (selecao)/                escolha de ambiente, para quem tem mais de uma conta
  (impressao)/              a OS para impressão
  global-error.tsx          último recurso: falha no próprio layout raiz

src/
  components/               componentes React, uma pasta por módulo
    shell/                  casca: topbar, sidebar, esqueleto, fronteira de erro
  lib/                      regras PURAS, sem banco e sem React
  server/
    actions/                Server Actions — toda mutação entra por aqui
    repositories/           único acesso ao Prisma; todo query escopado por conta
    auth/                   sessão, can(), revogação
    log.ts                  registro de falha inesperada

prisma/
  schema.prisma             o modelo, com o porquê de cada decisão em comentário
  migrations/               escritas à mão e versionadas (ver AD-5)
  seed.ts                   bootstrap da primeira conta e do administrador raiz

scripts/
  dev-local.mjs             o banco local descartável
  cenario-de-teste.ts       cenário mínimo multiconta
  dados-de-demonstracao.ts  volume plausível de cadastros para demonstração
  checar-deriva.mjs         migrations x schema declarado
  estado-do-banco.mjs       leitura de diagnóstico (seguro contra produção)

tests/                      ver tests/LEIA-ME.md
vercel.json                 região das funções (ver "Implantação")
```

### Onde mexer, por tipo de mudança

| Quero… | Mexo em |
| --- | --- |
| mudar uma tela | `src/components/<modulo>/` |
| mudar uma validação de formulário | `src/server/actions/<modulo>.ts` |
| mudar uma consulta ou escrita | `src/server/repositories/<modulo>.ts` |
| mudar uma regra pura (formatar, validar, calcular) | `src/lib/` |
| mudar o modelo de dados | `prisma/schema.prisma` **+ uma migration nova** |

A camada é sempre a mesma: **tela → Server Action → repositório → Prisma**. Uma
tela nunca fala com o Prisma, e um repositório nunca decide permissão.

---

## As siglas dos comentários

Os comentários do código citam `AD-1`, `NFR6`, `CAP-5`, "Story 7.4" o tempo
todo. Isto é o que significam.

**Aviso importante:** os documentos de planejamento que originaram essas siglas
estão em `_bmad-output/`, que **está no `.gitignore`** — não vêm no clone e
existem só na máquina de quem os gerou. Este índice é a única cópia versionada.
Se precisar de mais detalhe do que há aqui, a explicação canônica está no
próprio código, no arquivo indicado.

### CAP — capacidades do produto

`CAP-1` Ativos · `CAP-2` Tipos de ativo · `CAP-3` Itens revisionais ·
`CAP-4` Planos revisionais · `CAP-5` Emissões · `CAP-6` Painel inicial ·
`CAP-7` Usuários · `CAP-8` Contas (multiempresa) · `CAP-9` Perfis de acesso ·
`CAP-10` Autenticação · `CAP-11` Aparência

### AD — decisões de arquitetura

As treze primeiras vêm do documento de arquitetura, com estes títulos:

| | |
| --- | --- |
| **AD-1** | Isolamento multiempresa via repositório centralizado |
| **AD-2** | Autorização centralizada |
| **AD-3** | Server Actions como caminho padrão de mutação |
| **AD-4** | Interface portada do mockup, não redesenhada |
| **AD-5** | Migrations versionadas como única via de mudança de schema |
| **AD-6** | Banco isolado por ambiente via branching |
| **AD-7** | Rastreamento de erros desde o primeiro deploy |
| **AD-8** | Aplicabilidade de plano: centralizada e computada na leitura |
| **AD-9** | Escrita composta pai+filhos é transacional, com concorrência controlada |
| **AD-10** | Exclusão é soft-delete via status, nunca hard-delete em cascata |
| **AD-11** | Aparência: modo claro/escuro e paleta são mecanismos distintos |
| **AD-12** | Testes de isolamento e autorização são obrigatórios antes de publicar |
| **AD-13** | Operador de plataforma é papel separado do RBAC por conta |

De **AD-14 em diante** não existe definição canônica em documento nenhum: foram
estabelecidas durante a implementação e só existem nos comentários do código.
O que segue é o índice de onde cada uma está explicada.

| | | Explicada em |
| --- | --- | --- |
| **AD-14** | a área do Local é polígono decorativo em coordenadas do desenho, nunca latitude/longitude | `src/components/locais/mapa-editor.tsx` |
| **AD-15** | `Setor` é enum fixo e fica FORA do enum `Modulo` — não tem módulo de permissão próprio | `src/server/actions/emissao-estado.ts` |
| **AD-17** | Empresa não tem status; toda empresa cadastrada é sempre selecionável | `src/components/ativos/tipos.ts` |
| **AD-18** | mesmo padrão de Empresas: só "Editar", sem filtro de ativo/inativo | `src/components/emissao/tipos.ts` |
| **AD-19** | o código `EM-{ano}-{seq}` deriva só de `dataEmissao`; os marcos de agendamento não o influenciam | `prisma/schema.prisma` |
| **AD-20** | as linhas da aba Serviço são substituídas em bloco, sem id próprio | `src/server/repositories/emissao.ts` |
| **AD-23** | a guarda de sessão preservou a FORMA do retorno, e foi isso que evitou mudar todo chamador | `src/server/auth/sessao.ts` |
| **AD-24** | a troca de ambiente muta a conta ativa da sessão | `src/server/actions/auth.ts` |
| **AD-25** | `listarUsuarios` é a origem única do seletor de responsável | `src/server/repositories/usuario.ts` |
| **AD-26** | dado existente é corrigido de forma versionada, dentro da migration | `prisma/migrations/20260915210000_add_vinculo_conta/` |
| **AD-27** | provisionamento de conta tem uma via só, compartilhada pelo seed e pelo operador | `src/server/repositories/provisionamento.ts` |
| **AD-28** | duração é minuto inteiro no banco, com o modo (período ou duração) PERSISTIDO, nunca inferido | `src/lib/duracao.ts` |
| **AD-29** | totais são sempre derivados na leitura, nunca coluna | `src/components/emissao/modal-emissao.tsx` |
| **AD-30** | entrada inválida é RECUSADA com erro no campo — nunca zero silencioso nem truncamento | `src/components/emissao/modal-emissao.tsx` |
| **AD-31** | o estado de um item da aba Itens é derivado na leitura, em três níveis | `src/server/actions/emissao-estado.ts` |
| **AD-32** | o plano da emissão é derivado do ativo escolhido | `src/components/emissao/modal-emissao.tsx` |
| **AD-33** | a data de emissão não é editável | `src/components/emissao/modal-emissao.tsx` |

### NFR — requisitos não funcionais citados no código

| | |
| --- | --- |
| **NFR2** | não vazar a existência de uma conta ou identidade para quem não deveria saber |
| **NFR6** | a conta ativa e o perfil são revalidados contra o banco a cada requisição |
| **NFR7** | nunca aceitar entrada inválida em silêncio (par de AD-30) |

### "Story N.M"

Numeração das histórias de implementação. Serve para situar no tempo o que
mudou e por quê — e, quando o comentário cita uma, é porque aquele trecho
existe por causa dela. O texto das histórias também está só em
`_bmad-output/`.

---

## Invariantes que não se quebram

Estas não são preferências de estilo. Quebrar qualquer uma delas é defeito, e
há teste prendendo cada uma.

**Toda leitura e toda escrita é escopada por `contaId`.** Sem exceção. Uma
linha filha que não tem `contaId` próprio filtra pelo lado do pai. Um `id` de
outra conta precisa simplesmente *não ser encontrado* — nunca ser encontrado e
recusado depois. Ver `tests/isolamento.test.ts`.

**`can()` roda no servidor antes de todo efeito.** A tela usa o MESMO resultado
para esconder ou desabilitar botão; nunca existe uma segunda checagem paralela
no cliente. As ações são só `criar`, `editar` e `excluir` — **não existe ação
`ver`**, então não há controle de leitura por perfil.

**Nada de negócio é apagado.** "Excluir" é mudar o status para
`Inativo`/`Arquivado` pela mesma função de repositório que a edição comum usa.

**O schema só muda por migration escrita à mão e versionada.** Nunca
`prisma migrate dev` contra a `DATABASE_URL` do `.env.local`.
`npm run prisma:deriva` confere que as migrations e o schema declarado
concordam.

**Escrita composta é transacional**, com travamento otimista por `updatedAt`:
se a linha mudou desde que a tela a carregou, a gravação é recusada em vez de
sobrescrever.

**Entrada inválida é recusada com mensagem no campo.** Nunca virar zero, nunca
truncar.

---

## Testes

Detalhe completo em [`tests/LEIA-ME.md`](tests/LEIA-ME.md). O resumo:

Dois projetos de Vitest, separados pela extensão do arquivo:

| | arquivo | ambiente | duração |
| --- | --- | --- | --- |
| `servidor` | `*.test.ts` | Node + PostgreSQL real e efêmero | ~70–120s |
| `componente` | `*.componente.test.tsx` | jsdom + Testing Library | ~4–8s |

```bash
npm test                 # os dois
npm run test:servidor    # só o de servidor
npm run test:componente  # só o de componente
```

O projeto `servidor` sobe um PostgreSQL de verdade e usa o Prisma real — não há
banco dublado. O que é dublado é só a SESSÃO.

### A convenção que mais importa aqui

**Um teste só conta como pronto depois de falhar com o defeito reintroduzido à
mão.** Escrever o teste, ver verde e seguir adiante não prova nada: prova-se
que ele pega algo quebrando o código de propósito, confirmando que ele falha, e
desfazendo. Vários testes deste repositório nasceram passando sem exercitar
nada, e foi essa checagem que pegou.

Quando um teste **não** prende o que parece prender, o comentário dele diz
isso, em vez de alegar cobertura que não existe. Exemplo em
`tests/revisao-apos-emissao.test.ts`.

---

## Implantação

Vercel, conectada ao GitHub: **`git push` na `main` publica.** O build roda
`prisma migrate deploy && next build`, ou seja, **publicar aplica migrations
em produção**.

Antes de publicar, rode `npm run verificar` e confira se há migration nova no
diff — é a parte do deploy que não se desfaz com um clique.

**`vercel.json` fixa a região em `gru1` (São Paulo).** Isto não é detalhe: o
banco Neon está em `sa-east-1`, também São Paulo, e por um tempo as funções
rodavam em `iad1` (Washington). Cada consulta cruzava o continente — ~150 ms em
vez de ~20 ms — e o sistema inteiro parecia lento. Para conferir onde uma
função rodou, olhe o cabeçalho `x-vercel-id` da resposta: ele vem
`<borda>::<função>::<id>`.

### Decisões de desempenho que são deliberadas

**A sessão é guardada em banco, sem `cookieCache`.** Isso custa uma consulta
por requisição, e é de propósito: apagar a linha da sessão revoga o acesso na
hora. Ligar o `cookieCache` cortaria a consulta e faria uma sessão já apagada
continuar valendo por algum tempo.

**A sessão e a permissão são memoizadas por requisição** com o `cache` do
React, não entre requisições. Cada requisição revalida uma vez (NFR6), e uma
permissão retirada passa a valer na requisição seguinte (AD-2).

---

## Pontos de atenção conhecidos

Coisas que um mantenedor vai encontrar e merecem contexto:

- **As listas não são paginadas.** A conta inteira vai para o navegador, e a
  busca e os filtros rodam ali. É instantâneo e combina filtros, mas não
  escala para milhares de linhas. Paginar obriga a escolher entre busca no
  servidor (mais lenta) ou busca só na página atual (que mente).
- **`Modulo` é enum do Postgres.** Acrescentar um módulo exige migration, e
  nenhuma migration hoje preenche `PermissaoModulo` para os perfis que já
  existem — quem criar o próximo módulo precisa fazer esse preenchimento.
- **Prisma está preso em 6.19.3**, não 8: a versão 8 exige Node mais novo que o
  ambiente de desenvolvimento roda, e a biblioteca de autenticação suporta
  Prisma 5 a 7.
- **Esta versão do Next tem contratos diferentes** do que a maioria da
  documentação na internet descreve. Antes de escrever código de framework,
  leia o guia correspondente em `node_modules/next/dist/docs/` — é o que o
  `AGENTS.md` manda, e já evitou usar uma API depreciada.
