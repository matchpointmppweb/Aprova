# Testes

## Como rodar

```bash
npm test          # uma vez
npm run test:watch
npm run verificar # lint + typecheck + testes + deriva de schema
```

Nada precisa ser configurado. Não é preciso Docker, banco local instalado, nem
conta em nuvem.

## Como funciona

Cada execução sobe um **PostgreSQL 18 de verdade** (`embedded-postgres`) num
diretório temporário, aplica nele as migrations versionadas do projeto, roda os
testes e derruba tudo ao fim. A porta é sorteada a cada execução, então duas
execuções simultâneas não colidem.

Três decisões que valem entender antes de mexer aqui:

**Banco real, não mock.** Todos os defeitos graves encontrados nas revisões do
Epic 6 eram de banco: cláusula `where` incompleta, `updateMany` sem conferir
`count`, migration de colapso destrutiva. Nenhum deles aparece com o Prisma
mockado — o mock devolve o que o teste mandar devolver.

**Migrations, não `db push`.** Metade do que precisa ser verificado mora no SQL
escrito à mão (backfills, pós-condições, `ON DELETE` das chaves estrangeiras).
`db push` gera o schema a partir do datamodel e pularia exatamente essa parte,
deixando os testes passarem contra um banco que não é o que existe em produção.

**`DATABASE_URL` nunca é usada.** Ela aponta para o Neon compartilhado com
produção. O `globalSetup` a sobrescreve com a URL do banco efêmero, e
`tests/setup/ambiente.ts` **aborta a execução** se o valor não for o do banco
local — jamais "cai" para a URL real.

## O que a suíte cobre

O alvo não é percentual de cobertura. É blindar o que já se sabe que quebra:

- **`vinculo-conta.test.ts`** — as quatro regressões silenciosas identificadas
  nas revisões do Epic 6. Cada uma passa por ESLint, `tsc` e `next build` sem
  nada falhar, e três têm consequência de segurança direta.
- **`isolamento.test.ts`** — o requisito de isolamento estrito entre contas,
  incluindo o vazamento de **nomes** (a forma sutil, e a que de fato escapou até
  a revisão da Story 6.6) e a identidade global com perfis diferentes por conta.
- **`provisionamento.test.ts`** — a conta nova nasce com perfis e administrador,
  na mesma transação, ou não nasce.

Ao adicionar um teste, prefira nomear **a regressão que ele pega**, não a função
que ele chama. E confirme que ele falha: reintroduza o defeito, rode, e só então
o considere pronto — teste que nunca falhou não prova nada.

## Depuração

O ruído do initdb/postgres é suprimido. Quando a suspeita for a própria
infraestrutura:

```bash
VERBOSE_PG=1 npm test
```

## Limitação conhecida

Não há teste de interface: nada aqui renderiza uma página nem abre um navegador.
Layout, contraste e usabilidade continuam sendo verificação manual.

## Os dois projetos de teste

A suíte roda em dois projetos do Vitest, com ambientes incompatíveis entre si.
A divisão é pela EXTENSÃO do arquivo, então um teste novo cai no projeto certo
pelo próprio nome.

|          | `servidor`                    | `componente`                     |
| -------- | ----------------------------- | -------------------------------- |
| arquivos | `tests/**/*.test.ts`          | `tests/**/*.componente.test.tsx` |
| ambiente | Node                          | jsdom                            |
| banco    | PostgreSQL efêmero de verdade | nenhum                           |
| execução | serial (um banco só)          | paralela                         |
| custo    | ~70s                          | ~4s                              |
| comando  | `npm run test:servidor`       | `npm run test:componente`        |

`npm test` roda os dois.

### O que cada um pega — e o que não pega

O projeto `servidor` cobre REGRA: dado um estado, o que o sistema decide e o
que grava. É onde vivem os defeitos caros, e por isso ele usa banco real em vez
de Prisma mockado — um mock devolve o que o teste mandar, e nenhum `where`
frouxo aparece assim.

O projeto `componente` cobre FIAÇÃO: que a tela e a regra falam a mesma língua.
O caso que o motivou: os nomes dos campos (`servico-{i}-inicio`) são montados
por template string em dois lugares independentes, o componente e
`lerServicos`. Renomear só um dos lados não é erro de compilação. Medido em
29-10-2026: com o nome trocado no componente, os 353 testes de servidor
passavam verdes enquanto o modal parava de enviar o campo.

### O limite

Teste de componente é caro de manter: ele quebra com mudança de layout, não só
com defeito. Por isso ele é usado de propósito só onde há ACOPLAMENTO entre
tela e servidor que nada mais prende — não para cobrir aparência, e não como
substituto da conferência visual.
