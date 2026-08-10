// Aferição dos detectores contra as mensagens REAIS de clientes (wa_mensagens,
// papel='cliente'). Não é teste — é medição. Roda com:
//   npx tsx --tsconfig tsconfig.test.json scripts/afericao-detectores.ts
//
// Existe para responder duas perguntas que o teste unitário não responde:
//   1. o sem-entrada dispara demais na linguagem que o cliente REALMENTE usa?
//   2. quais cedentes o detector antigo perdeu?
// As frases abaixo saíram do banco em 10/08/2026 e estão congeladas aqui de
// propósito: a aferição precisa ser reexecutável sem acesso ao banco.
import { pareceCedente } from "../lib/farol/cedente";
import { gatilhoSemEntrada } from "../lib/farol/sem-entrada";

const MENSAGENS: string[] = [
  "Para uma carta de 750 mil",
  "Qual valor",
  "Tem alguém que parcela a entrada",
  "Mas não tenho entrada",
  "Na verdade u tenho um financiamento",
  "Mas eu preciso dar entrada ?",
  "Olá! Quero usar uma carta de consórcio contemplada para comprar um imóvel. Como funciona?",
  "Olá! Quero saber mais sobre as cotas contempladas disponíveis.",
  "Olá! Quero vender minha carta de consórcio contemplada pela bidcon.\n\n• Nome: Carlos Diniz\n• WhatsApp: +5531995703349\n• Tipo de bem: Veículo\n• Valor da carta: R$ 22.088",
  "Gostaria de uma Honda HR-v de ate 90.000,00",
  "oi, quero saber sobre cartas",
  "Olá! Quero saber mais sobre o repasse de consórcio na bidcon.",
  "Você poderia verificar para mim se tem alguma disponível?",
  "Olá! Boa noite. Tudo bem? Estou procurando uma carta contemplada para compra de um veículo entre os valores de R$100 a R$110 mil.",
  "Pode mandar a Serena! \nEu conheço a irma dela a Brisa",
  "Bora fechar a 419",
  "Cabe no meu bolso!",
  "Meu sonho é um GWM H9 ou im tank 300",
  "vcs tem qnt tempo de mercado?",
  "eu nao isso ai parece golpe kkk",
  "Consórcio veículo",
  "Quero vender minhas cartas",
  "Não quero receber",
  "Olá! Quero vender minha carta de consórcio contemplada e gostaria de mais informações pela bidcon.",
  "Se eu der um lance alto, e optar por parcelas menores e manutencao do prazo, consigo vender ela maks facil?",
  "Queria saber isso antes, pode me desenhar alguns cenários? Eu tenho 2 cotas contempladas e  1 que deve sair logo menos",
  "Caetano, minha situação é a seguinte estou avaliando a venda da carta mas gostaria de entender a lógica para determinar o ágio da venda, juntamente de qnt vcs cobram",
  "quero vender minha cota",
  "Quanto eu recebo líquido?\n\nQuem paga a taxa de cessão da Volkswagen?\n\nExiste mais alguma taxa além dessa?\n\nEm que momento o dinheiro é depositado na minha conta?",
  "Volkswagen \n001146\n45880\nSaldo: 40.114,47\nParcela: 607,84",
  "Olá! Quero vender minha carta de consórcio contemplada pela bidcon.\n\n• Nome: Indiara Litiere Andretta\n• WhatsApp: 48984906166\n• Tipo de bem: Veículo\n• Valor da carta: R$ 50.000",
  "Cancelada 03/07/2026",
  "Quero vender meu consórcio cancelado, como faço?",
  "Apresente-me",
  "Olá! Tenho interesse na carta contemplada de imóvel nº 57 — crédito de R$ 447.000, entrada de R$ 241.290 e parcela de R$ 1.737×225. Ainda está disponível?",
  "Olá, vim do site da Bidcon",
  "Quero comprar consórcio de carro de 100.000,00",
  "Olá! Gostaria de comprar consórcio.",
  "Faça uma análise dessas cotas",
  "Qual a melhor forma de ser contemplado no consórcio ?",
  "Olá, Prosperito! Simulei no site da Prospere: quero um veículo de R$ 150.000, no plano de parcela cheia, parcela de R$ 2.213,55, prazo de 84 meses. Tenho uma reserva pra dar lance. Pode me mostrar o caminho?",
  "Posso vender meu crédito quando der contemplado ?",
  "Isso é um bom investimento? Quando vou ser contemplado?",
  "Quais formas de lance ?",
  "Quero um imóvel de 300 mil, plano novo",
  "Quero um imóvel de 1,2 milhão, e isso é um bom investimento? Quando vou ser contemplado?",
  'Oi, quero começar um consórcio novo, nunca fui contemplado. Penso em um imóvel, mas não sei bem quanto cabe no meu bolso"',
  "quero carta de imóvel até 150 mil, entrada de uns 60",
  "Vender minhas carta",
  "Vender minha carta",
];

console.log("=".repeat(78));
console.log("SEM-ENTRADA — o que disparou");
console.log("=".repeat(78));
let n = 0;
for (const m of MENSAGENS) {
  const g = gatilhoSemEntrada(m);
  if (g) {
    n++;
    console.log(`  [${g}]  ${m.replace(/\n/g, " ⏎ ").slice(0, 90)}`);
  }
}
console.log(`\n  TOTAL: ${n} de ${MENSAGENS.length}`);

console.log("\n" + "=".repeat(78));
console.log("CEDENTE — quem o detector antigo MARCOU");
console.log("=".repeat(78));
let c = 0;
for (const m of MENSAGENS) {
  if (pareceCedente(m)) {
    c++;
    console.log(`  ✓ ${m.replace(/\n/g, " ⏎ ").slice(0, 90)}`);
  }
}
console.log(`\n  TOTAL: ${c} de ${MENSAGENS.length}`);

console.log("\n" + "=".repeat(78));
console.log("CEDENTE — candidatos PERDIDOS (falam de venda e nao foram marcados)");
console.log("=".repeat(78));
// Peneira grossa de propósito: qualquer menção a desfazimento que o detector
// NÃO marcou. Cabe a um humano julgar um a um — por isso a lista sai crua.
const PENEIRA = /vend|ceder|cedo|repass|transferir|agio|ágio|desfazer/i;
let p = 0;
for (const m of MENSAGENS) {
  if (!pareceCedente(m) && PENEIRA.test(m)) {
    p++;
    console.log(`  ✗ ${m.replace(/\n/g, " ⏎ ").slice(0, 110)}`);
  }
}
console.log(`\n  TOTAL PERDIDOS: ${p}`);
