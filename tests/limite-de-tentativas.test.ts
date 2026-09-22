import { beforeEach, describe, expect, test } from "vitest";

import {
  ipDosCabecalhos,
  limparFalhas,
  limparTentativasAntigas,
  registrarFalha,
  tentativaPermitida,
} from "@/src/server/auth/limite-de-tentativas";

import { db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

const EMAIL = "alvo@teste.local";
const IP = "203.0.113.7";

async function falhar(vezes: number, email = EMAIL, ip: string | null = IP) {
  for (let i = 0; i < vezes; i++) {
    await registrarFalha("login", email, ip);
  }
}

describe("limite por e-mail (ataque dirigido a uma conta)", () => {
  test("permite enquanto estiver abaixo do limite", async () => {
    await falhar(9);
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(true);
  });

  test("bloqueia ao atingir o limite", async () => {
    await falhar(10);
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(false);
  });

  test("o bloqueio de um e-mail não atinge outro", async () => {
    await falhar(10);
    expect(await tentativaPermitida("login", "outro@teste.local", null)).toBe(true);
  });

  test("sucesso zera o histórico daquele e-mail", async () => {
    await falhar(10);
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(false);

    await limparFalhas("login", EMAIL);
    expect(await tentativaPermitida("login", EMAIL, null)).toBe(true);
  });

  // A assimetria deliberada: um atacante com uma conta própria válida poderia,
  // senão, zerar a cota de IP a cada acerto e pulverizar indefinidamente.
  test("sucesso NÃO zera o histórico do IP", async () => {
    // 30 falhas no mesmo IP, espalhadas por e-mails diferentes.
    for (let i = 0; i < 30; i++) {
      await registrarFalha("login", `vitima-${i}@teste.local`, IP);
    }
    await limparFalhas("login", "vitima-0@teste.local");

    expect(await tentativaPermitida("login", "qualquer@teste.local", IP)).toBe(false);
  });
});

describe("limite por IP (pulverização entre muitos e-mails)", () => {
  // O buraco que o limite por e-mail sozinho deixa: uma senha comum tentada
  // contra centenas de e-mails diferentes nunca encosta no limite por e-mail,
  // porque cada um acumula uma falha só.
  test("bloqueia pulverização que nunca encostaria no limite por e-mail", async () => {
    for (let i = 0; i < 30; i++) {
      const email = `alvo-${i}@teste.local`;
      expect(await tentativaPermitida("login", email, IP)).toBe(true);
      await registrarFalha("login", email, IP);
    }

    // O 31º e-mail, nunca tentado antes, já não passa.
    expect(await tentativaPermitida("login", "novo@teste.local", IP)).toBe(false);
  });

  test("o bloqueio de um IP não atinge outro", async () => {
    for (let i = 0; i < 30; i++) {
      await registrarFalha("login", `alvo-${i}@teste.local`, IP);
    }
    expect(await tentativaPermitida("login", "novo@teste.local", "198.51.100.2")).toBe(
      true,
    );
  });

  test("sem IP identificável, o limite por e-mail continua valendo", async () => {
    await falhar(10, EMAIL, null);
    expect(await tentativaPermitida("login", EMAIL, null)).toBe(false);
  });
});

describe("cotas separadas por tipo", () => {
  // Errar a senha não pode gastar a cota de RECUPERAÇÃO — que é exatamente o
  // caminho de quem errou a senha. Somar as duas trancaria a pessoa fora sem
  // saída.
  test("estourar o login não bloqueia a recuperação de senha", async () => {
    await falhar(10);
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(false);
    expect(await tentativaPermitida("reset", EMAIL, IP)).toBe(true);
  });

  test("a recuperação tem limite próprio, mais apertado", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await tentativaPermitida("reset", EMAIL, IP)).toBe(true);
      await registrarFalha("reset", EMAIL, IP);
    }
    expect(await tentativaPermitida("reset", EMAIL, IP)).toBe(false);
    // E o login, intocado.
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(true);
  });
});

describe("janela de tempo", () => {
  test("tentativas fora da janela não contam", async () => {
    await falhar(10);
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(false);

    // Envelhece as tentativas para além da janela de 15 minutos do login.
    await db.tentativaDeAcesso.updateMany({
      data: { criadoEm: new Date(Date.now() - 16 * 60 * 1000) },
    });

    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(true);
  });

  test("a limpeza descarta o que já não influencia limite nenhum", async () => {
    await falhar(3);
    // Mais velho que a MAIOR janela (60 min, da recuperação).
    await db.tentativaDeAcesso.updateMany({
      data: { criadoEm: new Date(Date.now() - 61 * 60 * 1000) },
    });
    await falhar(2);

    await limparTentativasAntigas();

    // Sobram só as recentes: 2 falhas × 2 chaves (e-mail e IP).
    expect(await db.tentativaDeAcesso.count()).toBe(4);
  });

  test("a limpeza nunca apaga o que ainda vale", async () => {
    await falhar(10);
    await limparTentativasAntigas();
    expect(await tentativaPermitida("login", EMAIL, IP)).toBe(false);
  });
});

describe("identificação do IP a partir dos cabeçalhos", () => {
  test("x-real-ip tem precedência", () => {
    const cabecalhos = new Headers({
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "1.2.3.4",
    });
    expect(ipDosCabecalhos(cabecalhos)).toBe("203.0.113.9");
  });

  // O cliente pode forjar entradas em x-forwarded-for; o proxy da plataforma
  // acrescenta o IP real ao FIM. Ler o primeiro deixaria qualquer um escolher
  // sua própria identidade e escapar do limite por IP.
  test("de x-forwarded-for, usa o ÚLTIMO salto, não o primeiro", () => {
    const cabecalhos = new Headers({
      "x-forwarded-for": "9.9.9.9, 10.0.0.1, 203.0.113.5",
    });
    expect(ipDosCabecalhos(cabecalhos)).toBe("203.0.113.5");
  });

  test("sem cabeçalho nenhum, devolve null", () => {
    expect(ipDosCabecalhos(new Headers())).toBeNull();
  });

  test("cabeçalho vazio não vira IP vazio", () => {
    expect(ipDosCabecalhos(new Headers({ "x-forwarded-for": "  ,  " }))).toBeNull();
  });
});
