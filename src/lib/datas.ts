// Formatação de data/hora para LEITURA HUMANA (pt-BR), fora de componente
// para poder ser usada pelo cliente e pelo servidor — a OS impressa é Server
// Component e o modal de emissão é "use client", e uma segunda cópia da
// função divergiria com o tempo.
//
// Estas funções tratam INSTANTE REAL (um ponto no tempo atribuído pelo
// servidor, como `dataEmissao` ou `createdAt`) e por isso usam getters
// LOCAIS. NÃO servem para o wall-clock DIGITADO pelo usuário (os marcos
// agendamento/início/fim): esse caminho tem `paraDatetimeLocal`
// (getters getUTC*) em src/components/emissao/modal-emissao.tsx, que fecha o
// round trip com `parseDataHora`. Confundir as duas já causou bug de 3h.

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

/// "27/10/2026 14:05". Devolve "" para null — campo opcional não preenchido
/// imprime vazio, nunca "Invalid Date".
export function formatarInstante(data: Date | null | undefined): string {
  if (!data) return "";
  return (
    `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()} ` +
    `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`
  );
}

/// Só o dia — "27/10/2026". Para a OS impressa, onde a hora de alguns marcos
/// é ruído no papel.
export function formatarDia(data: Date | null | undefined): string {
  if (!data) return "";
  return `${doisDigitos(data.getDate())}/${doisDigitos(data.getMonth() + 1)}/${data.getFullYear()}`;
}
