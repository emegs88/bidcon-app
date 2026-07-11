// ============================================================================
// POST/GET/DELETE /api/mcp — conector MCP público da Bidcon (streamable HTTP).
// ----------------------------------------------------------------------------
// MCP-01 (fase 03 da Vitrine Viva): expõe UMA tool de leitura, buscar_cartas,
// pro ecossistema de agentes de IA (Claude e afins) consultarem o estoque
// real da Bidcon sob demanda. Mesma fonte pública já usada pela vitrine
// SSR (scripts/gerar-vitrine.mjs) e pelo endpoint /api/vitrine — a RPC
// `buscar_cartas` (xtv) já é pública (SECURITY INVOKER, EXECUTE em `anon`,
// grant confirmado nesta fatia), então esta rota usa SÓ a chave publicável
// (BIDCON_PUBLISHABLE_KEY) — zero service_role, mesmo espírito de
// scripts/gerar-vitrine.mjs.
//
// Stateless: cada requisição instancia seu próprio McpServer/transport
// (sessionIdGenerator: undefined) — sem estado entre chamadas, compatível
// com serverless (Vercel). Padrão oficial do SDK pra esse tipo de deploy.
//
// Kill-switch: MCP_ATIVO precisa ser exatamente "true" — senão 404 (não
// revela que a rota existe). Sem allowlist de origem (spec: v1 é leitura
// pública, sem auth — dado já é público pela migration 0041); rate-limit
// por IP próprio (lib/mcp-rate-limit.ts, isolado do store de api-guard.ts,
// que atende um público diferente).
// ============================================================================
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { ipDe } from "@/lib/api-guard";
import { mcpRateLimitExcedido } from "@/lib/mcp-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
};

// Domínio de tipo_bem usado no resto do repo (vw_cartas_publicas.tipo).
const TIPOS_BEM = ["veiculo", "imovel"] as const;

type LinhaCartaPublica = {
  ref: number;
  tipo: string;
  credito: number;
  entrada: number;
  parcela: number;
  parcelas: number;
  custo_am: number | null;
  administradora: string;
  atualizado: string;
};

// Description da tool: é o texto que o modelo do OUTRO lado (Claude, etc.)
// lê pra decidir como apresentar os dados ao usuário final. Compliance de
// linguagem (CLAUDE.md) e o aviso de segurança da Conta Notarial vivem
// aqui — nunca só em comentário de código.
const DESCRICAO_BUSCAR_CARTAS = `Busca cartas de crédito de consórcio disponíveis no estoque real da Bidcon (Grupo Prospere), com filtros opcionais por tipo, faixa de crédito e administradora. Retorna no máximo 10 resultados por chamada.

Regras obrigatórias ao apresentar os resultados:
- Os valores retornados (entrada, parcela, custo a.m.) são FINAIS — a entrada já inclui a intermediação da Bidcon. Nunca recalcule, some comissão de novo ou apresente um "valor com desconto" diferente do retornado.
- Sempre cite a administradora de cada carta ao apresentá-la; nunca omita esse dado.
- Use o léxico: "planejamento", "compra programada", "carta de crédito", "poder de compra", "patrimônio". NUNCA use: "investimento", "investidor", "rendimento", "retorno", "lucro", "CDI" — consórcio não é produto financeiro de rentabilidade.
- Nunca prometa ou sugira data de contemplação (sorteio/lance não têm data previsível).
- "custo_am" é o custo financeiro em TIR ao mês — nunca apresente como percentual nominal simples.
- Segurança: os pagamentos na Bidcon são protegidos por Conta Notarial — o valor fica custodiado em cartório (5º Tabelionato de Notas de Campinas, conta vinculada no Banco Safra) e só é liberado ao vendedor após a administradora aprovar a transferência da carta. Mencione isso quando o usuário perguntar sobre segurança ou forma de pagamento; nunca prometa "risco zero" ou "garantia total".`;

function ativo(): boolean {
  return process.env.MCP_ATIVO === "true";
}

// Instancia um McpServer novo por requisição (stateless) e registra a
// única tool desta fatia.
function criarServidorMcp(): McpServer {
  const server = new McpServer(
    { name: "bidcon-vitrine", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "buscar_cartas",
    {
      title: "Buscar cartas de crédito Bidcon",
      description: DESCRICAO_BUSCAR_CARTAS,
      inputSchema: {
        tipo: z
          .enum(TIPOS_BEM)
          .optional()
          .describe("Tipo de bem: 'veiculo' ou 'imovel'. Omitir para ambos."),
        credito_min: z
          .number()
          .positive()
          .optional()
          .describe("Valor mínimo do crédito, em reais."),
        credito_max: z
          .number()
          .positive()
          .optional()
          .describe("Valor máximo do crédito, em reais."),
        administradora: z
          .string()
          .optional()
          .describe("Nome (ou parte do nome) da administradora."),
        limite: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Quantidade máxima de resultados (padrão e teto: 10)."),
      },
    },
    async ({ tipo, credito_min, credito_max, administradora, limite }) => {
      const limiteClampado = Math.min(10, Math.max(1, limite ?? 10));

      const xtvUrl = process.env.BIDCON_XTV_URL;
      const chave = process.env.BIDCON_PUBLISHABLE_KEY;
      if (!xtvUrl || !chave) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Configuração ausente no servidor (BIDCON_XTV_URL / BIDCON_PUBLISHABLE_KEY).",
            },
          ],
        };
      }

      try {
        const resp = await fetch(`${xtvUrl}/rest/v1/rpc/buscar_cartas`, {
          method: "POST",
          headers: {
            apikey: chave,
            Authorization: `Bearer ${chave}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_tipo: tipo ?? null,
            p_credito_min: credito_min ?? null,
            p_credito_max: credito_max ?? null,
            p_administradora: administradora ?? null,
            p_limite: limiteClampado,
          }),
        });

        if (!resp.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Falha ao consultar o estoque (status ${resp.status}).`,
              },
            ],
          };
        }

        const linhas = (await resp.json()) as LinhaCartaPublica[];

        if (linhas.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Nenhuma carta encontrada com esses filtros.",
              },
            ],
            structuredContent: { cartas: [] },
          };
        }

        const texto = linhas
          .map((c) => {
            const tipoLabel = c.tipo === "veiculo" ? "Veículo" : "Imóvel";
            const custo =
              c.custo_am != null ? `${c.custo_am.toFixed(2)}% a.m.` : "—";
            return (
              `#${c.ref} — ${tipoLabel} · crédito ${brl(c.credito)} · ` +
              `entrada ${brl(c.entrada)} · parcela ${brl(c.parcela)}×${c.parcelas} · ` +
              `custo ${custo} · administradora: ${c.administradora}`
            );
          })
          .join("\n");

        return {
          content: [{ type: "text" as const, text: texto }],
          structuredContent: { cartas: linhas },
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Falha interna ao consultar o estoque.",
            },
          ],
        };
      }
    }
  );

  return server;
}

function brl(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

// Handler compartilhado por POST/GET/DELETE: cada chamada monta seu próprio
// server+transport (stateless) e delega ao SDK, que já sabe rotear pelo
// método HTTP do Request recebido.
async function handleMcp(req: Request): Promise<Response> {
  if (!ativo()) {
    return new Response(null, { status: 404 });
  }

  const ip = ipDe(req);
  if (mcpRateLimitExcedido(ip)) {
    return new Response(
      JSON.stringify({ error: "limite de requisições excedido" }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const server = criarServidorMcp();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  const resposta = await transport.handleRequest(req);

  const headers = new Headers(resposta.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);

  return new Response(resposta.body, {
    status: resposta.status,
    headers,
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleMcp(req);
}

export async function GET(req: Request): Promise<Response> {
  return handleMcp(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMcp(req);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
