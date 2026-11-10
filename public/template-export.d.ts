export interface PdfText {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  family: string;
  bold?: boolean;
  italic?: boolean;
  angle?: number;
}
export interface PdfPage {
  width: number;
  height: number;
  background: string;
  texts: PdfText[];
}
export interface Binding {
  id: string;
  key: string;
  type: "string" | "number" | "date";
  required: boolean;
  sample: string;
  source?: string;
  width?: number;
  height?: number;
}
export function escapeHtml(value: unknown): string;
export function validIdentifier(value: string): boolean;
export function exportTemplate(
  pages: PdfPage[],
  bindings: Binding[],
  functionName?: string,
): {
  html: string;
  preview: string;
  typescript: string;
  schema: { fields: Record<string, { type: string; required: boolean }> };
  sampleData: Record<string, string | number>;
  config: Record<string, unknown>;
  usage: string;
  readme: string;
};
