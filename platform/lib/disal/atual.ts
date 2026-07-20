// Ponto único de import do boletim Disal vigente. Quando sair o próximo
// boletim (ex.: agosto/2026), criar lib/disal/boletim-2026-08.ts no mesmo
// formato e trocar SÓ a linha abaixo — nenhum outro arquivo do app precisa
// mudar.
export { BOLETIM_DISAL_2026_07 as BOLETIM_DISAL_ATUAL } from "./boletim-2026-07";
