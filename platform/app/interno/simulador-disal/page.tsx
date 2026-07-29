"use client";
// /interno/simulador-disal — rota. Casca fina: todo o conteúdo (e os pontos
// de teste) vive em ./SimuladorDisalConteudo, porque page.tsx não pode ter
// exports nomeados além dos reservados do App Router.

import { SimuladorDisalConteudo } from "./SimuladorDisalConteudo";

export default function SimuladorDisal() {
  return <SimuladorDisalConteudo />;
}
