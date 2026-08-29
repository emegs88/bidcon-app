// ============================================================================
// OUVIDO-01 v2, item (d) — o aviso de transcrição no prompt das personas.
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE, E NÃO UMAS LINHAS DENTRO DE prompt-ponte.test.ts:
// aquele arquivo declara no cabeçalho que cobre SÓ o item (b) do HANDOFF-01 e
// que "o resto do prompt segue descoberto". Enfiar OUVIDO ali dentro tornaria
// aquela frase mentira sem ninguém reescrevê-la. Escopo declarado só vale se
// custar um arquivo novo quando muda.
//
// O QUE ESTÁ EM JOGO. Até esta fatia, áudio do cliente virava turno vazio e ele
// não era respondido. Agora é — mas por um texto que uma MÁQUINA ouviu, e o
// Whisper erra exatamente onde esta casa não pode errar: dígito de valor,
// número de grupo/cota e nome próprio. O aviso é o que faz a persona conferir
// antes de agir sobre um número que ela não leu, ouviu.
//
// OS DOIS LADOS, porque um só não prova nada:
//   · o aviso PRECISA alcançar as oito personas no whatsapp — é lá que o áudio
//     chega, e a persona que vai respondê-lo não é conhecida quando ele chega;
//   · o aviso NÃO PODE alcançar o site — a transcrição grava em `wa_mensagens`
//     e o canal 'site' lê `conversas`, outra tabela. Ensinar a persona do site
//     a desconfiar de número num texto que sempre foi DIGITADO é fabricar
//     hesitação onde não há dúvida nenhuma.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { montarSystem, AGENTES, type AgenteId } from "@/app/api/atende/_prompt";
import { PREFIXO_TRANSCRICAO } from "./tipos";

const TODAS = Object.keys(AGENTES) as AgenteId[];

test("AVISO — chega a TODAS as personas no whatsapp", () => {
  // Não dá para escolher a persona certa na chegada do áudio: quem responde é
  // quem estiver com o bastão. Por isso o aviso mora na base comum do canal, e
  // é esta varredura que prova que ele não ficou preso numa persona só.
  assert.ok(TODAS.length === 8, `esperava 8 personas, achei ${TODAS.length}`);
  for (const agente of TODAS) {
    const s = montarSystem(agente, "whatsapp");
    assert.ok(
      s.includes("ÁUDIO TRANSCRITO"),
      `${agente}/whatsapp não recebeu a seção do áudio transcrito`
    );
  }
});

test("AVISO — a ordem do item (d) está lá, inteira", () => {
  // A frase que a coordenação pediu, verbatim no que importa: o risco (erro de
  // transcrição) e a conduta (confirmar antes de agir), amarrados a NÚMERO e
  // NOME, que são os dois campos que o Whisper troca e que a casa não pode
  // errar. Comportamento, não redação: a prosa em volta pode ser reescrita.
  const s = montarSystem("valentina", "whatsapp");
  assert.ok(s.includes("erros de transcrição"), "sumiu o risco declarado");
  assert.ok(s.includes("número"), "sumiu a palavra 'número' — é metade do dano");
  assert.ok(s.includes("nome"), "sumiu a palavra 'nome' — é a outra metade");
  assert.ok(
    s.includes("confirme com o cliente antes de agir"),
    "sumiu a CONDUTA — sem ela o aviso vira observação inútil"
  );
});

test("ACOPLAMENTO — o prompt cita a marca REAL, não uma cópia envelhecida", () => {
  // Este teste importa `PREFIXO_TRANSCRICAO` de tipos.ts, que é a MESMA
  // constante que transcricao.ts escreve na mensagem. Se um dia alguém mudar a
  // marca no código e o prompt tiver ficado com uma cópia literal antiga, o
  // agente passaria a ser avisado sobre uma marca que nunca mais chega — falha
  // silenciosa, invisível ao tsc e ao build. Aqui ela vira teste vermelho.
  const s = montarSystem("caetano", "whatsapp");
  assert.ok(
    s.includes(PREFIXO_TRANSCRICAO),
    `o prompt não cita a marca real ${PREFIXO_TRANSCRICAO} — prompt e código divergiram`
  );
});

test("CONTROLE — o site NÃO recebe o aviso (o lado que dói)", () => {
  // Sem este teste, mover o aviso para o PROMPT_BASE_COMUM — que é o lugar
  // óbvio e errado — passaria em todos os testes acima. Áudio não alcança o
  // canal do site; avisar lá é ensinar desconfiança sobre texto digitado.
  for (const agente of TODAS) {
    const s = montarSystem(agente, "site");
    assert.ok(
      !s.includes("ÁUDIO TRANSCRITO"),
      `${agente}/site recebeu um aviso sobre áudio que nunca chega nesse canal`
    );
    assert.ok(
      !s.includes(PREFIXO_TRANSCRICAO),
      `${agente}/site recebeu a marca ${PREFIXO_TRANSCRICAO}, que só existe no whatsapp`
    );
  }
});

test("CONTROLE — os dois canais são MESMO diferentes (Regra 9)", () => {
  // Se `montarSystem` ignorasse o canal e devolvesse sempre a mesma string, os
  // testes de presença e os de ausência não poderiam estar ambos certos — mas
  // um `montarSystem` quebrado que devolvesse "" faria os de ausência passarem
  // sozinhos. Esta linha impede a suíte de ficar verde por vazio.
  const wa = montarSystem("serena", "whatsapp");
  const site = montarSystem("serena", "site");
  assert.ok(wa.length > 500, "prompt do whatsapp suspeito de vazio");
  assert.ok(site.length > 500, "prompt do site suspeito de vazio");
  assert.notEqual(wa, site, "os dois canais devolveram o MESMO texto");
  assert.ok(site.includes("PERSONA: SERENA"), "a persona nem foi injetada no site");
});
