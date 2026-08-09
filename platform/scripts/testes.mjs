// Descobre os arquivos de teste e roda o test runner do Node passando-os POR
// NOME. Substitui o glob que ia como argumento no `npm test`.
//
// POR QUE ESTE ARQUIVO EXISTE (medido em 09/08/2026, PR #10 vermelho).
//
// O script era:
//     tsx --tsconfig tsconfig.test.json --test "lib/**/*.test.ts" ...
// Verde na máquina, VERMELHO no runner com
//     Could not find '.../platform/lib/**/*.test.ts'  (exit 1)
//
// A causa NÃO é o shell — e essa parte importa, porque o diagnóstico errado
// levaria ao conserto errado. O padrão está entre aspas dentro do package.json,
// então nem o zsh local nem o `sh` do runner jamais o expandiram. Medido: o
// mesmo comando sob `sh -c '...'` com aspas simples continua achando os 346
// testes nesta máquina. Quem expandia o glob era o PRÓPRIO NODE — o test runner
// ganhou suporte a padrão nos argumentos a partir da v22, e aqui roda v24. O
// runner do CI roda Node 20, onde o argumento é tratado como caminho literal, o
// arquivo não existe e a suíte inteira é pulada.
//
// Reproduzido localmente com `npx -y node@20`: mesma mensagem, mesmo exit 1.
//
// ALTERNATIVA MEDIDA E REPROVADA: passar o diretório (`--test lib`). Sob Node 20
// isso devolve `pass 0` e EXIT 0 — a descoberta padrão do Node 20 só reconhece
// extensões .js/.cjs/.mjs, e nenhum .test.ts entra. Seria trocar um CI vermelho
// por um CI VERDE QUE NÃO RODA NADA, que é estritamente pior: o vermelho ao
// menos grita.
//
// E NÃO se volta para a lista explícita de arquivos. O problema dela já mordeu
// três vezes nesta casa: arquivo de teste novo simplesmente não roda, sem erro e
// sem aviso, e o total continua subindo por causa dos outros (ver o bloco
// `_test` no package.json, fatia do fuso: 12 testes novos passavam sozinhos e a
// suíte seguia dizendo 283).
//
// A descoberta aqui é feita com `readdirSync` recursivo escrito à mão, e não com
// `fs.globSync`, porque `fs.glob` só existe a partir do Node 22 — usá-lo
// recriaria exatamente o bug que este arquivo conserta, um degrau acima.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["lib"];
const EH_TESTE = /\.test\.tsx?$/;

/** Caminhada recursiva simples. Sem dependência de versão, sem glob. */
function achar(dir, achados = []) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      achar(caminho, achados);
    } else if (EH_TESTE.test(item.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

const arquivos = DIRS.flatMap((d) => achar(join(raiz, d))).sort();

// PORTÃO. Zero arquivo encontrado é FALHA, nunca sucesso silencioso. É a lição
// do candidato reprovado acima: uma suíte que não acha nada e sai com 0 compra
// confiança sem entregar cobertura, e ninguém descobre até a produção quebrar.
if (arquivos.length === 0) {
  console.error(`[testes] nenhum *.test.ts(x) encontrado em ${DIRS.join(", ")} — abortando`);
  process.exit(1);
}

console.error(`[testes] ${arquivos.length} arquivos descobertos`);

const tsx = resolve(raiz, "node_modules/tsx/dist/cli.mjs");
const r = spawnSync(
  process.execPath,
  [tsx, "--tsconfig", "tsconfig.test.json", "--test", ...arquivos],
  { cwd: raiz, stdio: "inherit" }
);

// `status` é null quando o filho morreu por sinal; nesse caso 1, nunca 0.
process.exit(r.status ?? 1);
