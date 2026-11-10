export function templateGuide(
  functionName: string,
  sampleData: Record<string, string | number>,
): {
  usage: string;
  readme: string;
  integration: string;
  pdfjs: string;
};
