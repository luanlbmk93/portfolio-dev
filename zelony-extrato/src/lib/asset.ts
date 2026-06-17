/** Caminho correto para arquivos em /public com base /extrato/ */
export function publicAsset(file: string) {
  const base = import.meta.env.BASE_URL || '/';
  const clean = file.replace(/^\//, '');
  return `${base}${clean}`;
}
