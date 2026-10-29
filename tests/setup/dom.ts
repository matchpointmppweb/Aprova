// Setup do projeto `componente` (jsdom). Deliberadamente NÃO importa
// `ambiente.ts`: aqui não há banco, e a trava de DATABASE_URL de lá abortaria
// a execução por uma variável que este projeto nem usa.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom é um documento SÓ por arquivo, compartilhado entre os testes dele. Sem
// desmontar, o segundo teste acha os elementos do primeiro e `getByLabelText`
// quebra com "found multiple elements" — ou, pior, passa olhando para a tela
// errada.
afterEach(cleanup);
