// setupFiles: roda em cada arquivo de teste, DEPOIS do globalSetup e ANTES dos
// imports do próprio teste. A trava aqui é deliberadamente paranoica: se por
// qualquer motivo `DATABASE_URL` não for a do banco efêmero local, a execução
// para em vez de escrever no Neon compartilhado com produção.
const url = process.env.DATABASE_URL ?? "";

// Checa HOST e BANCO, não a porta — a porta é sorteada a cada execução para não
// colidir com um cluster órfão. O par "127.0.0.1" + "/raiz_teste" é o que
// nenhuma URL real do projeto satisfaz.
const eLocal = url.includes("@127.0.0.1:") && url.endsWith("/raiz_teste");

if (!eLocal) {
  throw new Error(
    "DATABASE_URL não aponta para o banco de teste efêmero. " +
      "Execução abortada para não escrever em banco real. Valor recebido: " +
      (url ? url.replace(/:\/\/[^@]*@/, "://<credenciais>@") : "(vazio)"),
  );
}
