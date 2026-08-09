// ============================================================================
// scripts/vozes.mjs — o cardápio de vozes da HeyGen, legível
// AUTORIZADO: Emerson Gomes dos Santos — decisão 6(b) da coordenação de
// 08/08/2026: "lista de vozes femininas PT-BR para eu escolher a voz da
// Valentina".
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE, e por que ele substitui um comando de uma linha.
// A primeira versão que eu entreguei era um `curl | jq`. O `jq` NÃO está
// instalado nesta máquina — o comando morreu em "command not found" e a
// medição não aconteceu. O defeito foi meu: entreguei um instrumento que
// dependia de uma ferramenta que eu não tinha medido existir.
//
// Este script depende SÓ do Node (v24 medido nesta máquina) e não tem nenhuma
// dependência de npm. Ele faz a chamada, peneira e imprime.
//
// O SEGREDO NÃO ENTRA NO HISTÓRICO. `DISPARO_SECRET` na linha de comando
// ficaria gravado no ~/.zsh_history em texto puro, e um `curl -H "Bearer ..."`
// também. Aqui o segredo é digitado num prompt com o eco DESLIGADO (não
// aparece na tela, não vai para o histórico) — ou lido da env, se já estiver
// exportada na sessão. Ele nunca é impresso, nunca é logado.
//
// SÓ LÊ. A rota /api/farol/reel-opcoes é um cardápio: não dispara render, não
// publica, não grava. Este script é um cliente dela.
//
// Rodar:  node scripts/vozes.mjs
// ============================================================================
import { createInterface } from "node:readline";

const URL_PADRAO = "https://app.bidcon.com.br/api/farol/reel-opcoes";

/**
 * Lê o segredo sem ecoar na tela.
 *
 * O truque é o mesmo do `sudo`: enquanto a pergunta está no ar, o terminal vai
 * para modo "raw" (sem eco) e o readline é instruído a não escrever o que
 * chega. Restaura o modo no final, inclusive se der erro — deixar um terminal
 * em raw mode é o tipo de coisa que quebra o shell depois que o script sai.
 */
function perguntarOculto(pergunta) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const eraTTY = process.stdin.isTTY;
    process.stdout.write(pergunta);
    rl.output.write = () => {}; // engole o eco das teclas
    rl.question("", (resposta) => {
      rl.close();
      if (eraTTY) process.stdout.write("\n");
      resolve(resposta.trim());
    });
  });
}

function linha(n = 76) {
  return "-".repeat(n);
}

/** Feminina segundo o campo `genero` da HeyGen, que vem em inglês. */
function ehFeminina(v) {
  return String(v.genero ?? "").trim().toLowerCase().startsWith("f");
}

async function main() {
  const url = process.argv[2] ?? URL_PADRAO;

  let secret = process.env.DISPARO_SECRET;
  if (secret) {
    console.log("• DISPARO_SECRET veio da env da sessão.");
  } else {
    secret = await perguntarOculto("DISPARO_SECRET (não aparece na tela): ");
  }
  if (!secret) {
    console.error("\nERRO: segredo vazio. A rota responde 401 sem ele.");
    process.exit(1);
  }

  console.log(`\nConsultando ${url} ...\n`);

  let resp;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  } catch (e) {
    console.error("ERRO de rede:", e?.message ?? e);
    process.exit(1);
  }

  const bruto = await resp.text();

  if (resp.status === 401) {
    console.error(
      "ERRO 401 nao_autorizado.\n" +
        "Duas causas possíveis, e vale distinguir:\n" +
        "  a) o segredo digitado não bate com o DISPARO_SECRET da Vercel; ou\n" +
        "  b) a env DISPARO_SECRET não está setada NO PROJETO bidcon-plataforma\n" +
        "     (a rota devolve 401 quando ela é ausente — ver `autorizado()`)."
    );
    process.exit(1);
  }

  let j;
  try {
    j = JSON.parse(bruto);
  } catch {
    console.error(`ERRO: a resposta não é JSON (HTTP ${resp.status}). Início do corpo:`);
    console.error(bruto.slice(0, 400));
    process.exit(1);
  }

  const vozes = Array.isArray(j.vozes) ? j.vozes : [];
  const femininas = vozes.filter(ehFeminina);

  console.log(linha());
  console.log(`VOZES PT-BR: ${vozes.length} no total, ${femininas.length} femininas`);
  console.log(`origem da lista: ${j.origem_vozes ?? "(não informado)"}`);
  console.log(linha());

  if (femininas.length === 0 && vozes.length > 0) {
    console.log(
      "\nNenhuma voz veio marcada como feminina. Isso pode ser a conta não\n" +
        "preencher `gender` — por isso a lista COMPLETA vem logo abaixo.\n"
    );
  }

  const imprimir = (lista, titulo) => {
    if (lista.length === 0) return;
    console.log(`\n### ${titulo}\n`);
    for (const v of lista) {
      console.log(`  ${v.nome ?? "(sem nome)"}  [${v.genero ?? "?"}]  ${v.idioma ?? "?"}`);
      console.log(`      id: ${v.id}`);
    }
  };

  imprimir(femininas, "FEMININAS — candidatas à voz da Valentina");
  imprimir(
    vozes.filter((v) => !ehFeminina(v)),
    "DEMAIS (referência: é aqui que está a voz do Porta-voz hoje)"
  );

  // Os avatares entram porque a decisão 6 também precisa confirmar em QUAL
  // família o id da Valentina (89c374...) aparece — é isso que decide se
  // HEYGEN_AVATAR_TIPO_2 fica 'avatar' (v3) ou 'talking_photo' (v2 legado).
  const familias = [
    ["avatares", j.avatares],
    ["talking_photos", j.talking_photos],
    ["talking_photos_legado", j.talking_photos_legado],
  ];
  console.log(`\n${linha()}\nAVATARES POR FAMÍLIA\n${linha()}`);
  for (const [nome, lista] of familias) {
    const arr = Array.isArray(lista) ? lista : [];
    console.log(`\n### ${nome} (${arr.length})\n`);
    for (const a of arr) console.log(`  ${a.nome ?? "(sem nome)"}\n      id: ${a.id}`);
  }

  if (Array.isArray(j.avisos) && j.avisos.length > 0) {
    console.log(`\n${linha()}\nAVISOS DA ROTA (leia: dizem como a lista foi montada)\n${linha()}`);
    for (const a of j.avisos) console.log(`  - ${a}`);
  }

  console.log("");
}

main().catch((e) => {
  console.error("ERRO inesperado:", e?.message ?? e);
  process.exit(1);
});
